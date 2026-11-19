package com.m9r1u5.retroradio;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RadioServicePlugin.class);
        super.onCreate(savedInstanceState);
        // Android 13+: allow the "now playing" notification with its Stop button
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // keep the WebView (and the radio stream) running in the background
        try { if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().onResume(); } catch (Exception ignored) { }
    }
}
