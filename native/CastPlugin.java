package com.m9r1u5.retroradio;

import android.net.Uri;

import androidx.mediarouter.app.MediaRouteChooserDialog;
import androidx.mediarouter.app.MediaRouteControllerDialog;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.images.WebImage;

/** Plays the radio on Google Home / Nest speakers and Chromecasts. JS name: RadioCast. Event: "castState". */
@CapacitorPlugin(name = "RadioCast")
public class CastPlugin extends Plugin {
    private CastContext cast;

    private final SessionManagerListener<CastSession> listener = new SessionManagerListener<CastSession>() {
        @Override public void onSessionStarting(CastSession s) { }
        @Override public void onSessionStarted(CastSession s, String id) { emit(s); }
        @Override public void onSessionStartFailed(CastSession s, int e) { emit(null); }
        @Override public void onSessionEnding(CastSession s) { }
        @Override public void onSessionEnded(CastSession s, int e) { emit(null); }
        @Override public void onSessionResuming(CastSession s, String id) { }
        @Override public void onSessionResumed(CastSession s, boolean wasSuspended) { emit(s); }
        @Override public void onSessionResumeFailed(CastSession s, int e) { emit(null); }
        @Override public void onSessionSuspended(CastSession s, int reason) { }
    };

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            try {
                cast = CastContext.getSharedInstance(getContext());
                cast.getSessionManager().addSessionManagerListener(listener, CastSession.class);
            } catch (Exception e) {
                cast = null; // no Google Play services
            }
        });
    }

    private void emit(CastSession s) {
        JSObject r = state(s);
        notifyListeners("castState", r, true);
    }

    private JSObject state(CastSession s) {
        JSObject r = new JSObject();
        boolean on = s != null && s.isConnected();
        r.put("available", cast != null);
        r.put("connected", on);
        String name = "";
        try { if (on && s.getCastDevice() != null) name = s.getCastDevice().getFriendlyName(); } catch (Exception ignored) { }
        r.put("device", name);
        return r;
    }

    private CastSession session() {
        return cast == null ? null : cast.getSessionManager().getCurrentCastSession();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(state(session())));
    }

    /** Shows the list of speakers to cast to (or the "stop casting" dialog when already casting). */
    @PluginMethod
    public void pick(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (cast == null) { call.reject("Casting needs Google Play services"); return; }
            try {
                CastSession s = session();
                if (s != null && s.isConnected()) {
                    new MediaRouteControllerDialog(getActivity()).show();
                } else {
                    MediaRouteChooserDialog d = new MediaRouteChooserDialog(getActivity());
                    d.setRouteSelector(cast.getMergedSelector());
                    d.show();
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not open the speaker list: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void castMedia(PluginCall call) {
        final String url = call.getString("url");
        final String title = call.getString("title", "Retro Radio");
        final String subtitle = call.getString("subtitle", "");
        final String image = call.getString("image", "");
        final String type = call.getString("contentType", "audio/mpeg");
        getActivity().runOnUiThread(() -> {
            CastSession s = session();
            RemoteMediaClient rmc = s == null ? null : s.getRemoteMediaClient();
            if (rmc == null || url == null) { call.reject("Not casting"); return; }
            MediaMetadata md = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK);
            md.putString(MediaMetadata.KEY_TITLE, title);
            md.putString(MediaMetadata.KEY_ARTIST, subtitle);
            md.putString(MediaMetadata.KEY_ALBUM_TITLE, "Retro Radio");
            if (image != null && image.startsWith("http")) md.addImage(new WebImage(Uri.parse(image)));
            MediaInfo info = new MediaInfo.Builder(url)
                    .setContentUrl(url)
                    .setStreamType(MediaInfo.STREAM_TYPE_LIVE)
                    .setContentType(type)
                    .setMetadata(md)
                    .build();
            rmc.load(new MediaLoadRequestData.Builder().setMediaInfo(info).setAutoplay(true).build())
                    .setResultCallback(res -> {
                        JSObject r = new JSObject();
                        r.put("ok", res.getStatus().isSuccess());
                        r.put("code", res.getStatus().getStatusCode());
                        call.resolve(r);
                    });
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { CastSession s = session(); if (s != null && s.getRemoteMediaClient() != null) s.getRemoteMediaClient().stop(); } catch (Exception ignored) { }
            call.resolve();
        });
    }

    @PluginMethod
    public void end(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { if (cast != null) cast.getSessionManager().endCurrentSession(true); } catch (Exception ignored) { }
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        final double v = call.getDouble("volume", 0.5);
        getActivity().runOnUiThread(() -> {
            try { CastSession s = session(); if (s != null) s.setVolume(Math.max(0, Math.min(1, v))); } catch (Exception ignored) { }
            call.resolve();
        });
    }
}
