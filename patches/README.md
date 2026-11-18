# Panels UI macOS window patch

`panels-ui-macos-dock-reopen.patch` applies to [Panels UI 1.27.0](https://github.com/santiagorod92/foo_ui_panels/tree/5ea065692af068c10f387c9331986271fab2a3ae). Closing the player window hides foobar2000 and its other open windows. macOS can restore them when you reopen the running app. Command-Q still quits the player.

The build uses Xcode Command Line Tools, CMake 3.21 or newer, and the GitHub CLI. Run these commands from the foobox-macos checkout.

```sh
mkdir -p build/window-reopen/panels build/window-reopen/sdk
gh api repos/santiagorod92/foo_ui_panels/tarball/5ea065692af068c10f387c9331986271fab2a3ae > build/window-reopen/panels.tar.gz
gh api repos/reupen/foobar2000-sdk-unmodified/tarball/9e4823ee802dfb704de1ce42401b48b407a54180 > build/window-reopen/sdk.tar.gz
tar -xzf build/window-reopen/panels.tar.gz -C build/window-reopen/panels --strip-components 1
tar -xzf build/window-reopen/sdk.tar.gz -C build/window-reopen/sdk --strip-components 1
patch -d build/window-reopen/panels -p1 < patches/panels-ui-macos-dock-reopen.patch

cmake -S build/window-reopen/panels -B build/window-reopen/native \
  -DCMAKE_BUILD_TYPE=Release -DSDK_ROOT="$PWD/build/window-reopen/sdk" \
  -DCMAKE_OSX_ARCHITECTURES="$(uname -m)" -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0
cmake --build build/window-reopen/native --target foo_ui_panels --parallel
codesign --force --sign - build/window-reopen/native/foo_ui_panels.component
```

The resulting bundle targets the build machine's architecture. Quit foobar2000 and back up the existing component before replacing the bundle at `~/Library/foobar2000-v2/user-components/foo_ui_panels/foo_ui_panels.component`. The theme package continues to ship the official component. Updating Panels UI may replace the local patch.
