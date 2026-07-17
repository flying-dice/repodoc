---
column: todo
labels: [ci]
priority: high
updatedAt: 2026-07-17T12:05:00.000Z
---
# Publish to the VS Code Marketplace

Take the packaged VSIX beyond a GitHub release attachment and publish it to the
Visual Studio Marketplace under the `flying-dice` publisher. Set up the
publisher access token as a CI secret and add a `vsce publish` step to the
release workflow so tagged releases go straight to the marketplace.
