package com.m9r1u5.retroradio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/** Foreground service that keeps the radio stream alive with the screen off. */
public class RadioService extends Service {
    static RadioService instance;
    private static final String CHANNEL = "retro_radio_playback";
    private static final int NOTIF_ID = 1947;
    private static final String ACTION_STOP = "com.m9r1u5.retroradio.STOP";

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Radio playback", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RetroRadio::Playback");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "RetroRadio::Wifi");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        } catch (Exception ignored) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = "Retro Radio", text = "";
        if (intent != null) {
            if (ACTION_STOP.equals(intent.getAction())) {
                RadioServicePlugin.stopPressed();
                stopSelf();
                return START_NOT_STICKY;
            }
            if (intent.getStringExtra("title") != null) title = intent.getStringExtra("title");
            if (intent.getStringExtra("text") != null) text = intent.getStringExtra("text");
        }
        Notification n = build(title, text);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIF_ID, n);
        return START_NOT_STICKY;
    }

    void update(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, build(title, text));
    }

    private Notification build(String title, String text) {
        int immutable = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent openPi = open == null ? null : PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | immutable);
        Intent stop = new Intent(this, RadioService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | immutable);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title)
                .setContentText(text.isEmpty() ? "Playing" : text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(android.R.drawable.ic_media_pause, "Stop", stopPi);
        if (openPi != null) b.setContentIntent(openPi);
        return b.build();
    }

    @Override
    public void onDestroy() {
        instance = null;
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) { }
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) { }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
