"""Patches the generated Capacitor Android project (run from the repo root after `npx cap add android`).
- copies the native radio service + plugin + MainActivity
- adds permissions, the foreground service and cleartext streaming to AndroidManifest.xml
- replaces the launcher icons with icon-512.png
"""
import os, re, shutil, glob

PKG = 'com/m9r1u5/retroradio'
java_dir = os.path.join('android/app/src/main/java', PKG)
os.makedirs(java_dir, exist_ok=True)
for f in ('MainActivity.java', 'RadioService.java', 'RadioServicePlugin.java'):
    shutil.copy(os.path.join('native', f), os.path.join(java_dir, f))

mf = 'android/app/src/main/AndroidManifest.xml'
x = open(mf, encoding='utf-8').read()
perms = ['android.permission.INTERNET', 'android.permission.WAKE_LOCK', 'android.permission.FOREGROUND_SERVICE',
         'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'android.permission.POST_NOTIFICATIONS',
         'android.permission.ACCESS_NETWORK_STATE', 'android.permission.ACCESS_WIFI_STATE']
add = ''.join(f'    <uses-permission android:name="{p}" />\n' for p in perms if p not in x)
x = x.replace('<application', add + '\n    <application', 1)
if 'usesCleartextTraffic' not in x:
    x = x.replace('<application', '<application\n        android:usesCleartextTraffic="true"', 1)
service = ('        <service android:name=".RadioService" android:exported="false" '
           'android:foregroundServiceType="mediaPlayback" />\n')
if '.RadioService' not in x:
    x = x.replace('</application>', service + '    </application>', 1)
open(mf, 'w', encoding='utf-8').write(x)
print(x)

# launcher icons
try:
    from PIL import Image
    src = Image.open('icon-512.png').convert('RGBA')
    sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for d, n in sizes.items():
        folder = f'android/app/src/main/res/mipmap-{d}'
        os.makedirs(folder, exist_ok=True)
        im = src.resize((n, n), Image.LANCZOS)
        for name in ('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'):
            im.save(os.path.join(folder, name))
    for f in glob.glob('android/app/src/main/res/mipmap-anydpi-v26/*'):
        os.remove(f)  # use the plain PNG icons instead of adaptive ones
    print('icons replaced')
except Exception as e:
    print('icon step skipped:', e)
