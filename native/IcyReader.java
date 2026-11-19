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
 * Uses a raw socket so it also works with old "ICY 200 OK" servers.
 */
public class IcyReader {

    public static String read(String url) throws IOException {
        return read(url, 0);
    }

    private static String read(String url, int depth) throws IOException {
        if (depth > 5) return null;
        URL u = new URL(url);
        boolean https = "https".equalsIgnoreCase(u.getProtocol());
        int port = u.getPort() > 0 ? u.getPort() : (https ? 443 : 80);
        Socket plain = new Socket();
        plain.connect(new InetSocketAddress(u.getHost(), port), 8000);
        Socket s = https ? ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(plain, u.getHost(), port, true) : plain;
        s.setSoTimeout(8000);
        try {
            String path = u.getFile();
            if (path == null || path.isEmpty()) path = "/";
            String host = u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
            OutputStream out = s.getOutputStream();
            out.write(("GET " + path + " HTTP/1.0\r\nHost: " + host + "\r\nUser-Agent: RetroRadio/1.1\r\n"
                    + "Icy-MetaData: 1\r\nAccept: */*\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            InputStream in = new BufferedInputStream(s.getInputStream());

            String status = line(in);
            if (status == null) return null;
            String[] parts = status.trim().split("\\s+");
            int code = parts.length > 1 ? parseInt(parts[1], 0) : 0;
            Map<String, String> headers = new HashMap<>();
            String h;
            while ((h = line(in)) != null && !h.isEmpty()) {
                int c = h.indexOf(':');
                if (c > 0) headers.put(h.substring(0, c).trim().toLowerCase(), h.substring(c + 1).trim());
            }
            if (code >= 300 && code < 400 && headers.containsKey("location")) {
                return read(new URL(u, headers.get("location")).toString(), depth + 1);
            }
            if (code != 200) return null;
            int metaint = parseInt(headers.get("icy-metaint"), 0);
            if (metaint <= 0) return null;

            for (int block = 0; block < 3; block++) {
                skipFully(in, metaint);
                int lenByte = in.read();
                if (lenByte < 0) return null;
                int len = lenByte * 16;
                if (len == 0) continue;
                byte[] meta = readFully(in, len);
                String title = extractTitle(decode(meta));
                if (title != null && !title.isEmpty()) return title;
            }
            return null;
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
        return meta.substring(i, j).replace('\0', ' ').trim();
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
}
