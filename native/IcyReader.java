package com.m9r1u5.retroradio;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import javax.net.ssl.SSLSocketFactory;

/**
 * Reads the "now playing" song title (ICY / Shoutcast / Icecast StreamTitle) from a radio stream.
 * Raw socket so it copes with "ICY 200 OK" servers, redirects, chunked responses and .pls/.m3u playlists.
 * Every step is written to a log so problems can be diagnosed on the phone.
 */
public class IcyReader {

    public static class Result {
        public String title = "";
        public String finalUrl = "";
        public final StringBuilder log = new StringBuilder();
    }

    public static String read(String url) {
        return probe(url).title;
    }

    public static Result probe(String url) {
        Result r = new Result();
        try {
            read(url, 0, r);
        } catch (Exception e) {
            r.log.append("ERROR: ").append(e.getClass().getSimpleName()).append(": ").append(e.getMessage()).append('\n');
        }
        return r;
    }

    private static void read(String url, int depth, Result r) throws IOException {
        if (depth > 6) { r.log.append("too many redirects\n"); return; }
        r.finalUrl = url;
        r.log.append("GET ").append(url).append('\n');
        URL u = new URL(url);
        boolean https = "https".equalsIgnoreCase(u.getProtocol());
        int port = u.getPort() > 0 ? u.getPort() : (https ? 443 : 80);
        Socket plain = new Socket();
        plain.connect(new InetSocketAddress(u.getHost(), port), 8000);
        Socket s = https ? ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(plain, u.getHost(), port, true) : plain;
        s.setSoTimeout(9000);
        try {
            String path = u.getFile();
            if (path == null || path.isEmpty()) path = "/";
            String host = u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
            OutputStream out = s.getOutputStream();
            out.write(("GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\n"
                    + "User-Agent: Mozilla/5.0 (Linux; Android) RetroRadio/1.2\r\n"
                    + "Icy-MetaData: 1\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            InputStream in = new BufferedInputStream(s.getInputStream());

            String status = line(in);
            if (status == null) { r.log.append("no response\n"); return; }
            r.log.append("  ").append(status).append('\n');
            String[] parts = status.trim().split("\\s+");
            int code = parts.length > 1 ? parseInt(parts[1], 0) : 0;
            Map<String, String> headers = new HashMap<>();
            String h;
            while ((h = line(in)) != null && !h.isEmpty()) {
                int c = h.indexOf(':');
                if (c > 0) {
                    String k = h.substring(0, c).trim().toLowerCase();
                    String v = h.substring(c + 1).trim();
                    headers.put(k, v);
                    if (k.startsWith("icy") || k.equals("content-type") || k.equals("location") || k.equals("server") || k.equals("transfer-encoding"))
                        r.log.append("  ").append(k).append(": ").append(v).append('\n');
                }
            }
            if (code >= 300 && code < 400 && headers.containsKey("location")) {
                s.close();
                read(new URL(u, headers.get("location")).toString(), depth + 1, r);
                return;
            }
            if (code != 200) { r.log.append("  not 200, giving up\n"); return; }
            if ("chunked".equalsIgnoreCase(headers.get("transfer-encoding"))) in = new Chunked(in);

            String ct = String.valueOf(headers.get("content-type")).toLowerCase();
            if (ct.contains("scpls") || ct.contains("mpegurl") || ct.contains("text/") || url.toLowerCase().matches(".*\\.(pls|m3u8?)(\\?.*)?$")) {
                String body = new String(readUpTo(in, 8192), StandardCharsets.ISO_8859_1);
                if (body.contains("#EXT-X-")) { r.log.append("  HLS stream - no ICY song info\n"); return; }
                for (String l : body.split("\\r?\\n")) {
                    String t = l.trim();
                    int eq = t.indexOf('=');
                    if (t.toLowerCase().startsWith("file") && eq > 0) t = t.substring(eq + 1).trim();
                    if (t.startsWith("http")) {
                        r.log.append("  playlist -> ").append(t).append('\n');
                        s.close();
                        read(t, depth + 1, r);
                        return;
                    }
                }
                r.log.append("  text response, no stream link found\n");
                return;
            }

            int metaint = parseInt(headers.get("icy-metaint"), 0);
            if (metaint <= 0) { r.log.append("  no icy-metaint: this stream does not send song names\n"); return; }

            for (int block = 0; block < 8; block++) {
                skipFully(in, metaint);
                int lenByte = in.read();
                if (lenByte < 0) { r.log.append("  stream ended\n"); return; }
                int len = lenByte * 16;
                if (len == 0) { r.log.append("  block ").append(block).append(": empty\n"); continue; }
                String meta = decode(readFully(in, len)).replace("\0", "").trim();
                r.log.append("  block ").append(block).append(": ").append(meta.length() > 300 ? meta.substring(0, 300) + "..." : meta).append('\n');
                String title = extractTitle(meta);
                if (title != null && !title.isEmpty()) { r.title = title; return; }
            }
            r.log.append("  no title in 8 blocks\n");
        } finally {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    static String extractTitle(String meta) {
        int i = meta.indexOf("StreamTitle='");
        if (i < 0) return null;
        i += "StreamTitle='".length();
        int j = meta.indexOf("';", i);
        if (j < 0) j = meta.lastIndexOf('\'');
        if (j < i) j = meta.length();
        return meta.substring(i, j).trim();
    }

    /** Simple HTTP GET returning text (used for "now playing" web services). */
    public static String fetchText(String url) throws IOException {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) RetroRadio/1.2");
        try (InputStream in = c.getInputStream()) {
            return new String(readUpTo(in, 262144), StandardCharsets.UTF_8);
        } finally {
            c.disconnect();
        }
    }

    private static String decode(byte[] b) {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(b)).toString();
        } catch (CharacterCodingException e) {
            return new String(b, StandardCharsets.ISO_8859_1);
        }
    }

    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') bo.write(c);
            if (bo.size() > 8192) break;
        }
        if (c == -1 && bo.size() == 0) return null;
        return new String(bo.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static byte[] readUpTo(InputStream in, int max) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] tmp = new byte[4096];
        int r;
        while (bo.size() < max && (r = in.read(tmp, 0, Math.min(tmp.length, max - bo.size()))) > 0) bo.write(tmp, 0, r);
        return bo.toByteArray();
    }

    private static void skipFully(InputStream in, int n) throws IOException {
        byte[] tmp = new byte[8192];
        while (n > 0) {
            int r = in.read(tmp, 0, Math.min(tmp.length, n));
            if (r < 0) throw new IOException("stream ended");
            n -= r;
        }
    }

    private static byte[] readFully(InputStream in, int n) throws IOException {
        byte[] b = new byte[n];
        int off = 0;
        while (off < n) {
            int r = in.read(b, off, n - off);
            if (r < 0) throw new IOException("stream ended");
            off += r;
        }
        return b;
    }

    private static int parseInt(String s, int d) {
        try { return s == null ? d : Integer.parseInt(s.trim()); } catch (NumberFormatException e) { return d; }
    }

    /** De-chunks an HTTP/1.1 "Transfer-Encoding: chunked" body. */
    static class Chunked extends InputStream {
        private final InputStream in;
        private int left = 0;
        private boolean started = false, eof = false;

        Chunked(InputStream in) { this.in = in; }

        private boolean next() throws IOException {
            if (eof) return false;
            if (started) line(in); // CRLF after the previous chunk
            started = true;
            String sz = line(in);
            if (sz == null) { eof = true; return false; }
            int semi = sz.indexOf(';');
            if (semi >= 0) sz = sz.substring(0, semi);
            try { left = Integer.parseInt(sz.trim(), 16); } catch (NumberFormatException e) { eof = true; return false; }
            if (left == 0) { eof = true; return false; }
            return true;
        }

        @Override
        public int read() throws IOException {
            if (left == 0 && !next()) return -1;
            int b = in.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (len == 0) return 0;
            if (left == 0 && !next()) return -1;
            int r = in.read(b, off, Math.min(len, left));
            if (r > 0) left -= r;
            return r;
        }
    }
}
