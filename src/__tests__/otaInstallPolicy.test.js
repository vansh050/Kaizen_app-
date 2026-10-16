const fs = require('fs');
const path = require('path');

const findFile = (dir, name) => {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
};

describe('OTA install policy', () => {
  // This white-label app has no signed OTA deployment yet: the bundled entry
  // point is used and nothing may load a CodePush bundle.
  test('uses the bundled entry point until the app has signed OTA', () => {
    const entry = fs.readFileSync(path.join(process.cwd(), 'index.js'), 'utf8');

    expect(entry).toContain('AppRegistry.registerComponent(appName, () => App)');
    expect(entry).not.toContain('@revopush/react-native-code-push');

    const mainApplication = findFile(
      path.join(process.cwd(), 'android/app/src/main/java'),
      'MainApplication.kt',
    );
    expect(mainApplication).toBeTruthy();
    expect(fs.readFileSync(mainApplication, 'utf8')).not.toContain('CodePush.getJSBundleFile()');
  });
});
