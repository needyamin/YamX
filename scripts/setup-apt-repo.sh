#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$PROJECT_DIR/apt-repo"
VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
DEB_NAME="ymax_${VERSION}_amd64.deb"
DEB_PATH="$PROJECT_DIR/dist/$DEB_NAME"
GPG_KEY_ID="${YAMX_GPG_KEY_ID:-ymax-apt-signing@example.invalid}"

echo "Setting up APT repository in $REPO_DIR..."

# Clean and recreate structure
rm -rf "$REPO_DIR"
mkdir -p "$REPO_DIR/dists/stable/main/binary-amd64"
mkdir -p "$REPO_DIR/pool/main/y/ymax"

# Copy all .deb packages
if [ -d "$PROJECT_DIR/dist" ]; then
    cp "$PROJECT_DIR/dist/"*.deb "$REPO_DIR/pool/main/y/ymax/" 2>/dev/null || true
fi

# Generate Packages file
cd "$REPO_DIR"
if command -v dpkg-scanpackages >/dev/null 2>&1; then
    dpkg-scanpackages pool/main /dev/null > dists/stable/main/binary-amd64/Packages 2>/dev/null
else
    echo "WARNING: dpkg-scanpackages not found. Generating minimal Packages file..."
    DEB_SIZE=$(stat -c%s "$DEB_PATH" 2>/dev/null || stat -f%z "$DEB_PATH" 2>/dev/null || echo 0)
    DEB_MD5=$(md5sum "$DEB_PATH" 2>/dev/null | awk '{print $1}' || echo "")
    DEB_SHA1=$(sha1sum "$DEB_PATH" 2>/dev/null | awk '{print $1}' || echo "")
    DEB_SHA256=$(sha256sum "$DEB_PATH" 2>/dev/null | awk '{print $1}' || echo "")
    [ -f "$DEB_PATH" ] || DEB_SIZE=0
    cat > dists/stable/main/binary-amd64/Packages << EOF
Package: ymax
Version: $VERSION
Architecture: amd64
Maintainer: Yamin <https://github.com/needyamin>
Installed-Size: $((DEB_SIZE / 1024))
Filename: pool/main/y/ymax/$DEB_NAME
Size: $DEB_SIZE
MD5sum: $DEB_MD5
SHA1: $DEB_SHA1
SHA256: $DEB_SHA256
Description: Terminal-first coding and operations agent
EOF
fi

# Compress Packages
gzip -k -f dists/stable/main/binary-amd64/Packages

# Generate Release file
cd "$REPO_DIR/dists/stable"
cat > Release << EOF
Origin: YamX
Label: YamX APT Repository
Suite: stable
Codename: stable
Version: 1.0
Architectures: amd64
Components: main
Description: YamX terminal agent APT repository
Date: $(date -Ru 2>/dev/null || date +"%a, %d %b %Y %H:%M:%S %z")
EOF

# Add hashes for the index files
add_hash_block() {
    local algo="$1"
    local label="$2"
    local cmd="$3"
    echo "$label:" >> Release
    for file in main/binary-amd64/Packages main/binary-amd64/Packages.gz; do
        if [ -f "$file" ]; then
            HASH=$($cmd "$file" | awk '{print $1}')
            SIZE=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
            echo " $HASH $SIZE $file" >> Release
        fi
    done
}

add_hash_block md5sum "MD5Sum" md5sum
add_hash_block sha1sum "SHA1" sha1sum
add_hash_block sha256sum "SHA256" sha256sum

# Sign the repository and export the public key
cd "$REPO_DIR"
if command -v gpg >/dev/null 2>&1; then
    echo "=> Signing repository..."
    if ! gpg --list-secret-keys "$GPG_KEY_ID" >/dev/null 2>&1; then
        echo "=> No signing key found, generating one..."
        gpg --batch --yes --quick-generate-key "$GPG_KEY_ID" rsa3072 sign never 2>/dev/null \
            || gpg --batch --yes --passphrase '' --quick-generate-key "$GPG_KEY_ID" default default never
    fi
    rm -f Release.gpg InRelease
    gpg --batch --yes --default-key "$GPG_KEY_ID" --armor --detach-sign \
        -o "$REPO_DIR/dists/stable/Release.gpg" "$REPO_DIR/dists/stable/Release"
    gpg --batch --yes --default-key "$GPG_KEY_ID" --clearsign \
        -o "$REPO_DIR/dists/stable/InRelease" "$REPO_DIR/dists/stable/Release"
    gpg --batch --yes --armor --export "$GPG_KEY_ID" > "$REPO_DIR/KEY.gpg"
    echo "=> Signed. Public key written to apt-repo/KEY.gpg"
else
    echo "WARNING: gpg not found. Repo will be unsigned; clients must use [trusted=yes]."
fi

echo ""
echo "APT repository created in $REPO_DIR"
echo ""
echo "To serve locally for testing:"
echo "  cd $REPO_DIR && python3 -m http.server 8080"
echo ""
echo "To use on a client (signed repo):"
echo "  curl -fsSL http://your-server:8080/KEY.gpg | sudo gpg --dearmor -o /usr/share/keyrings/ymax.gpg"
echo "  echo 'deb [signed-by=/usr/share/keyrings/ymax.gpg] http://your-server:8080 stable main' | sudo tee /etc/apt/sources.list.d/ymax.list"
echo "  sudo apt-get update && sudo apt-get install ymax"
echo ""
echo "Unsigned fallback:"
echo "  echo 'deb [trusted=yes] http://your-server:8080 stable main' | sudo tee /etc/apt/sources.list.d/ymax.list"
