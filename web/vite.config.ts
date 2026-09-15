import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "app-icon.svg"],
      manifest: {
        id: "/",
        name: "Wuxia Reader",
        short_name: "WuxiaTTS",
        description:
          "Listen to wuxia and other web novels read aloud. Share a chapter link from Chrome and it strips ads, reads it out loud, and auto-advances to the next chapter.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#1b1230",
        theme_color: "#1b1230",
        orientation: "portrait",
        icons: [
          {
            src: "app-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "app-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
        // Lets an installed copy of this app show up as a destination in
        // Android's/Chrome's share sheet when sharing a URL/text from any
        // other app (e.g. Chrome's page-share menu).
        share_target: {
          action: "/share-target",
          method: "GET",
          enctype: "application/x-www-form-urlencoded",
          params: {
            title: "title",
            text: "text",
            url: "url",
          },
        },
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  server: {
    host: true,
  },
});
