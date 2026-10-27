const assert=require('node:assert/strict'),fs=require('node:fs');
const manifest=JSON.parse(fs.readFileSync('public/downloads/deeplist.json','utf8'));
// Shipped Deeplist updaters pin this URL; changing it breaks installed apps.
assert.equal(manifest.downloadUrl,'https://world.damndeepak.workers.dev/downloads/deeplist.apk','Keep the feed compatible with already-installed Deeplist updaters');
assert.equal(manifest.packageId,'com.deepu.wordstorm');
assert.equal(manifest.signingCertificateSha256,'1c73c95916d7e14bac0533d0a4a20a3c01be78f066fcc0c1102254712c4bcd5d');
assert.ok(Number.isSafeInteger(manifest.versionCode)&&manifest.versionCode>0);
assert.ok(Number.isSafeInteger(manifest.sizeBytes)&&manifest.sizeBytes>0);
assert.match(manifest.sha256,/^[a-f0-9]{64}$/);
assert.match(manifest.versionName,/^\d+\.\d+\.\d+$/);
assert.ok(Number.isFinite(Date.parse(manifest.publishedAt)));
assert.ok(Array.isArray(manifest.changelog)&&manifest.changelog.every(line=>typeof line==='string'));
const asset='https://github.com/Damndeepak/Metrolist/releases/download/deeplist-'+manifest.versionCode+'/Deeplist.apk';
assert.equal(manifest.assetUrl,asset);
const route=fs.readFileSync('public/_redirects','utf8').split('\n').find(line=>line.startsWith('/downloads/deeplist.apk '));
assert.equal(route,'/downloads/deeplist.apk '+asset+' 302','Pinned URL must lead to the version described by the manifest');
console.log('PASS: installed updater feed contract, original app identity, release metadata and version-matched public APK redirect');
