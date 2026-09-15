import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.supermidget.wuxiareader",
  appName: "Wuxia Reader",
  webDir: "dist",
  android: {
    allowMixedContent: true,
  },
};

export default config;
