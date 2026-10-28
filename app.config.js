// app.json stays the source of truth; this only swaps in the real AdMob
// *app* IDs (the plugin bakes them into Info.plist / AndroidManifest at
// build time) when ADMOB_APP_ID_IOS / ADMOB_APP_ID_ANDROID are set — e.g.
// as EAS environment variables. Without them it keeps Google's test app
// IDs, same as before, so local/dev builds never serve real ads. The banner
// *unit* IDs are separate and read at runtime in lib/ads.ts.
module.exports = ({ config }) => ({
  ...config,
  plugins: config.plugins.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === "react-native-google-mobile-ads"
      ? [
          plugin[0],
          {
            ...plugin[1],
            iosAppId: process.env.ADMOB_APP_ID_IOS || plugin[1].iosAppId,
            androidAppId: process.env.ADMOB_APP_ID_ANDROID || plugin[1].androidAppId,
          },
        ]
      : plugin
  ),
});
