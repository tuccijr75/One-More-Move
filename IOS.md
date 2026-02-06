# iOS Porting Notes

This project can be packaged for iOS using Capacitor so the existing HTML/Canvas game runs inside a native WebView.

## Prerequisites
- macOS with Xcode installed.
- Node.js 18+ (or the version you already use for the project).

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Initialize the iOS platform (one-time):
   ```bash
   npx cap add ios
   ```
3. Sync the web assets:
   ```bash
   npm run cap:sync
   ```
4. Open the iOS project:
   ```bash
   npm run ios:open
   ```
5. Build and run from Xcode on a simulator or device.

## Build an IPA
Capacitor relies on Xcode to produce the IPA. After syncing the web assets:

1. Open the iOS project:
   ```bash
   npm run ios:open
   ```
2. In Xcode, select the **Any iOS Device (arm64)** run destination.
3. Choose **Product → Archive** to create an archive.
4. In the Organizer window, select the archive and click **Distribute App**.
5. Follow the prompts to export an **Ad Hoc**, **App Store**, or **Development** IPA.

> Note: IPA signing requires an Apple Developer account and provisioning profiles configured in Xcode.

## Windows workflow with Sideloadly
Sideloadly can install an existing IPA on a device from Windows, but it still needs an IPA built on macOS/Xcode. A typical flow is:

1. Ask a macOS user or CI runner to produce the IPA using the steps above.
2. Copy the exported `.ipa` to your Windows machine.
3. Download a sideloading tool (Sideloadly or AltStore) and keep the IPA handy.
4. Connect your iPhone/iPad via USB and trust the computer when prompted.
5. On the device, enable **Developer Mode** under **Settings → Privacy & Security**.
6. In Sideloadly:
   - Select the IPA.
   - Sign in with your Apple ID (or a dedicated signing account).
   - Click **Start** to sideload.
7. On the device, trust the developer certificate under **Settings → General → VPN & Device Management**.
8. Launch the sideloaded app from the home screen.

> Note: If you need to build the IPA yourself, you must use macOS/Xcode (local or CI). Windows-only builds are not supported by Apple tooling.

## Notes
- The iOS web assets live in `app/ios/`, which Capacitor uses as the `webDir`.
- Touch controls are enabled automatically on devices with coarse pointers.
