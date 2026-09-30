#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
ARCH="amd64"
PACKAGE_NAME="ymax_${VERSION}_${ARCH}.deb"
STAGING="$PROJECT_DIR/packaging/debian"

echo "Building Debian package for ymax v$VERSION..."

# 1. Build the project
echo "=> Building project..."
cd "$PROJECT_DIR"
npm run build

# 1b. Keep DEBIAN/control in sync with package.json version
CONTROL="$STAGING/DEBIAN/control"
if [ -f "$CONTROL" ]; then
    if grep -q '^Version:' "$CONTROL"; then
        sed -i.bak "s/^Version: .*/Version: $VERSION/" "$CONTROL" && rm -f "$CONTROL.bak"
    else
        echo "Version: $VERSION" >> "$CONTROL"
    fi
fi

# 2. Install production dependencies into staging
echo "=> Installing production dependencies..."
rm -rf "$STAGING/usr/lib/ymax/node_modules"
mkdir -p "$STAGING/usr/lib/ymax"

# Use a temp dir to avoid polluting the main project
TEMP_NODE_MODULES=$(mktemp -d)
cp "$PROJECT_DIR/package.json" "$TEMP_NODE_MODULES/"
cp "$PROJECT_DIR/package-lock.json" "$TEMP_NODE_MODULES/" 2>/dev/null || true
cd "$TEMP_NODE_MODULES"
npm ci --production --silent
cp -r "$TEMP_NODE_MODULES/node_modules" "$STAGING/usr/lib/ymax/"
rm -rf "$TEMP_NODE_MODULES"

# 3. Clean unnecessary files from node_modules to reduce size
echo "=> Cleaning node_modules..."
find "$STAGING/usr/lib/ymax/node_modules" -type f \( \
    -name "*.d.ts" -o \
    -name "*.map" -o \
    -name "*.test.js" -o \
    -name "*.spec.js" -o \
    -name "*.md" -o \
    -name "LICENSE" -o \
    -name "CHANGELOG" -o \
    -name ".editorconfig" -o \
    -name ".eslintrc*" -o \
    -name ".prettierrc*" -o \
    -name ".gitignore" \
\) -delete 2>/dev/null || true

find "$STAGING/usr/lib/ymax/node_modules" -type d \( \
    -name "test" -o \
    -name "tests" -o \
    -name "__tests__" -o \
    -name "docs" -o \
    -name "doc" -o \
    -name "examples" -o \
    -name "demo" -o \
    -name ".github" -o \
    -name ".git" \
\) -exec rm -rf {} + 2>/dev/null || true

# 4. Copy built artifacts
echo "=> Copying built artifacts..."
rm -rf "$STAGING/usr/lib/ymax/dist"
cp -r "$PROJECT_DIR/dist" "$STAGING/usr/lib/ymax/"

# 5. Copy docs and config
rm -rf "$STAGING/usr/lib/ymax/docs" "$STAGING/usr/lib/ymax/config"
cp -r "$PROJECT_DIR/docs" "$STAGING/usr/lib/ymax/" 2>/dev/null || true
cp -r "$PROJECT_DIR/config" "$STAGING/usr/lib/ymax/" 2>/dev/null || true

# 6. Create wrapper scripts
# Two binaries: ymax (new router-based CLI) and yamx (legacy agent CLI).
mkdir -p "$STAGING/usr/lib/ymax/bin"

cat > "$STAGING/usr/lib/ymax/bin/ymax" << 'EOF'
#!/usr/bin/env bash
set -e
export YAMX_INSTALL_MODE=system
export YAMX_DATA_DIR="${YAMX_DATA_DIR:-$HOME/.ymax}"
exec /usr/bin/node /usr/lib/ymax/dist/ymax.js "$@"
EOF

cat > "$STAGING/usr/lib/ymax/bin/yamx" << 'EOF'
#!/usr/bin/env bash
set -e
export YAMX_INSTALL_MODE=system
export YAMX_DATA_DIR="${YAMX_DATA_DIR:-$HOME/.yamx}"
exec /usr/bin/node /usr/lib/ymax/dist/index.js "$@"
EOF

chmod 755 "$STAGING/usr/lib/ymax/bin/ymax"
chmod 755 "$STAGING/usr/lib/ymax/bin/yamx"

# 7. Create symlinks in /usr/bin
mkdir -p "$STAGING/usr/bin"
ln -sf ../lib/ymax/bin/ymax "$STAGING/usr/bin/ymax"
ln -sf ../lib/ymax/bin/yamx "$STAGING/usr/bin/yamx"

# 8. Set permissions
find "$STAGING/usr/lib/ymax" -type d -exec chmod 755 {} \;
find "$STAGING/usr/lib/ymax" -type f -exec chmod 644 {} \;
chmod 755 "$STAGING/usr/lib/ymax/bin/ymax"
chmod 755 "$STAGING/usr/lib/ymax/bin/yamx"
chmod 755 "$STAGING/DEBIAN/preinst"
chmod 755 "$STAGING/DEBIAN/postinst"
chmod 755 "$STAGING/DEBIAN/prerm"
chmod 755 "$STAGING/DEBIAN/postrm"

# 9. Build the .deb
echo "=> Building .deb package..."
mkdir -p "$PROJECT_DIR/dist"
dpkg-deb --build "$STAGING" "$PROJECT_DIR/dist/$PACKAGE_NAME"

# 10. Report
SIZE=$(du -h "$PROJECT_DIR/dist/$PACKAGE_NAME" | cut -f1)
echo ""
echo "Package built: dist/$PACKAGE_NAME ($SIZE)"
echo ""
echo "Install locally with:"
echo "  sudo dpkg -i dist/$PACKAGE_NAME"
echo "  sudo apt-get install -f"
