#!/usr/bin/env python3
import os
import sys
import sqlite3
import json

DB_PATH = "/opt/izinet/xui-db/x-ui.db"

def main():
    print("====================================================")
    print("🛠️  IZINET DATABASE AUTO-REPAIR SCRIPT")
    print("====================================================")
    
    if not os.path.exists(DB_PATH):
        print(f"❌ Error: Database not found at {DB_PATH}")
        sys.exit(1)
        
    print(f"✅ Found database at {DB_PATH}. Connecting...")
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
    except Exception as e:
        print(f"❌ Failed to connect to database: {e}")
        sys.exit(1)
        
    try:
        cursor.execute("SELECT id, port, protocol, remark, enable, stream_settings FROM inbounds WHERE port=443;")
        inbound = cursor.fetchone()
    except Exception as e:
        print(f"❌ Failed to query database: {e}")
        conn.close()
        sys.exit(1)
        
    if not inbound:
        print("ℹ️ No inbound on port 443 was found.")
        conn.close()
        sys.exit(0)
        
    inbound_id, port, protocol, remark, enable, stream_settings_str = inbound
    print(f"\nFind inbound: ID={inbound_id}, Port={port}, Protocol={protocol}, Remark='{remark}', Enabled={enable}")
    
    # Try parsing stream settings
    try:
        stream_settings = json.loads(stream_settings_str) if stream_settings_str else {}
    except Exception as e:
        print(f"⚠️ Failed to parse stream settings JSON: {e}")
        stream_settings = {}
        
    print("\n--- Current Stream Settings ---")
    print(json.dumps(stream_settings, indent=2, ensure_ascii=False))
    
    is_modified = False
    security = stream_settings.get("security", "")
    
    # Check for Reality configuration and correct it
    if security == "reality":
        reality_settings = stream_settings.get("realitySettings", {})
        priv_key = reality_settings.get("privateKey", "")
        
        print(f"\n🔍 Detected Reality security. Current Private Key: {priv_key}")
        
        # If the privateKey is a filename path, or empty, or includes a Let's Encrypt file:
        if "/" in priv_key or "letsencrypt" in priv_key or priv_key.endswith(".pem") or not priv_key:
            print("⚠️ Invalid Reality private key format detected (contains file paths or Let's Encrypt certificates)!")
            print("👉 Reality MUST use a X25519 key (e.g. ABiVSJTP...), NOT an actual TLS file path.")
            
            # Setting up healthy X25519 Reality keypairs (perfect matching keys)
            new_private_key = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAAt0jErpzaGtEo"
            new_public_key = "CXL0o8BEC7wz-TluA7w-QBbJladSsb9xL7G6UB410Xw"
            
            reality_settings["privateKey"] = new_private_key
            reality_settings["publicKey"] = new_public_key
            
            # Ensure dest and serverNames are configured correctly to mimic a genuine site (e.g. microsoft)
            reality_settings["dest"] = "www.microsoft.com:443"
            reality_settings["serverNames"] = ["www.microsoft.com", "microsoft.com"]
            
            stream_settings["realitySettings"] = reality_settings
            is_modified = True
            print("✅ Successfully corrected PrivateKey, PublicKey, Dest and SNI settings inside JSON structure!")
        else:
            print("✅ Reality private key looks structurally valid (not a file path). No automatic cleanup required.")
            
        # --- NEW CODE: Check fallback configuration and correct 3005 to 3443 ---
        fallbacks = stream_settings.get("fallbacks", [])
        if fallbacks:
            print(f"\n🔍 Found {len(fallbacks)} custom fallback rule(s). Inspecting destinations...")
            for idx, fallback in enumerate(fallbacks):
                dest = str(fallback.get("dest", ""))
                if dest == "3005" or dest == "localhost:3005" or dest == "127.0.0.1:3005":
                    print(f"⚠️ Fallback #{idx+1} destination is set to '{dest}'.")
                    print("👉 This is incorrect! VLESS Reality fallback MUST send the encrypted TLS handshake to Nginx ssl port (3443), NOT to NodeJS plaintext port (3005) directly.")
                    fallback["dest"] = "3443"
                    is_modified = True
                    print(f"✅ Corrected Fallback #{idx+1} destination to '3443'.")
        else:
            print("\nℹ️ No fallbacks found in the config. Creating a proper fallback to port 3443...")
            stream_settings["fallbacks"] = [
                {
                    "name": "izinet.online",
                    "alpn": "any",
                    "path": "",
                    "dest": "3443",
                    "xver": 0
                }
            ]
            is_modified = True
            print("✅ Added standard fallback rule to redirect regular HTTPS traffic to port 3443!")
            
    else:
         print(f"ℹ️ Security protocol is set to: '{security}' instead of 'reality'.")
         
    if is_modified:
        try:
            updated_settings_str = json.dumps(stream_settings, separators=(',', ':'))
            # Let's perform the update
            cursor.execute("UPDATE inbounds SET stream_settings=? WHERE id=?;", (updated_settings_str, inbound_id))
            conn.commit()
            print("\n💾 Changes SAVED to database successfully!")
        except Exception as e:
            print(f"❌ Error while updating database: {e}")
            conn.rollback()
    else:
        print("\nℹ️ No modifications were necessary for the database.")
        
    conn.close()
    print("\n====================================================")
    print("🚀 Auto-repair script execution finished!")
    print("====================================================")

if __name__ == "__main__":
    main()
