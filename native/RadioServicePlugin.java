package com.m9r1u5.retroradio;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS bridge: RadioService.start({title, text}), RadioService.stop(), event "stopPressed". */
@CapacitorPlugin(name = "RadioService")
public class RadioServicePlugin extends Plugin {
    static RadioServicePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "Retro Radio");
        String text = call.getString("text", "");
        try {
            if (RadioService.instance != null) {
                RadioService.instance.update(title, text);
            } else {
                Intent i = new Intent(getContext(), RadioService.class);
                i.putExtra("title", title);
                i.putExtra("text", text);
                if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
                else getContext().startService(i);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start radio service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), RadioService.class));
        } catch (Exception ignored) { }
        call.resolve();
    }

    /** Reads the song title the station is broadcasting right now (ICY StreamTitle), with a diagnostic log. */
    @PluginMethod
    public void nowPlaying(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("No stream URL"); return; }
        new Thread(() -> {
            IcyReader.Result res = IcyReader.probe(url);
            JSObject r = new JSObject();
            r.put("title", res.title == null ? "" : res.title);
            r.put("finalUrl", res.finalUrl);
            r.put("log", res.log.toString());
            call.resolve(r);
        }).start();
    }

    /** Plain GET without browser CORS limits (for "now playing" web services). */
    @PluginMethod
    public void fetchText(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("No URL"); return; }
        new Thread(() -> {
            try {
                JSObject r = new JSObject();
                r.put("text", IcyReader.fetchText(url));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("fetch failed: " + e.getMessage());
            }
        }).start();
    }

    /** Opens Shazam and starts listening (falls back to opening the app, then the Play Store). */
    @PluginMethod
    public void openShazam(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        try {
            Intent i = new Intent("com.shazam.android.intent.actions.START_TAGGING");
            i.setPackage("com.shazam.android");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            r.put("opened", "tagging");
            call.resolve(r);
            return;
        } catch (Exception ignored) { }
        try {
            Intent i = ctx.getPackageManager().getLaunchIntentForPackage("com.shazam.android");
            if (i != null) {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                r.put("opened", "app");
                call.resolve(r);
                return;
            }
        } catch (Exception ignored) { }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.shazam.android"));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            r.put("opened", "store");
        } catch (Exception e) {
            r.put("opened", "none");
        }
        call.resolve(r);
    }

    static void stopPressed() {
        if (instance != null) instance.notifyListeners("stopPressed", new JSObject());
    }
}
