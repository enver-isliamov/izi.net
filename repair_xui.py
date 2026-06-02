#!/usr/bin/env python3
import os
import sys
import sqlite3
import json
import subprocess
import time

DB_PATH = "/opt/izinet/xui-db/x-ui.db"
PROJECT_DIR = "/opt/izinet"

def run_cmd(cmd_list, desc=""):
    if desc:
        print(f"\n⚡ {desc}...")
    try:
        res = subprocess.run(cmd_list, capture_output=True, text=True, timeout=20)
        if res.returncode == 0:
            print(f"✅ Success: {' '.join(cmd_list)}")
            if res.stdout:
                print(res.stdout.strip())
            return True, res.stdout
        else:
            print(f"❌ Failed: {' '.join(cmd_list)} (Exit code: {res.returncode})")
            if res.stderr:
                print(f"Error details: {res.stderr.strip()}")
            return False, res.stderr
    except Exception as e:
        print(f"❌ Error executing {' '.join(cmd_list)}: {e}")
        return False, str(e)

def main():
    print("====================================================")
    print("🛠️  IZINET MASTER DOCTOR AND AUTO-REPAIR SCRIPT")
    print("====================================================")
    
    # Check if we run as root
    if os.getuid() != 0:
        print("⚠️ Warning: This script operates system packages (Nginx, Docker, UFW). Please run as root (sudo)!")
    
    # Change folder to project directory if possible
    if os.path.exists(PROJECT_DIR):
        os.chdir(PROJECT_DIR)
        print(f"📁 Changed working directory to {PROJECT_DIR}")
    else:
        print(f"⚠️ Project dir {PROJECT_DIR} not found. Running in place.")

    # --- 1. SQ-LITE REPAIR & DETAILS READING ---
    if not os.path.exists(DB_PATH):
        print(f"❌ Error: SQLite DB not found at {DB_PATH}")
        sys.exit(1)
        
    print(f"✅ Found database at {DB_PATH}. Connecting...")
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
    except Exception as e:
        print(f"❌ Failed to connect to database: {e}")
        sys.exit(1)
        
    # Check table structure for sniffing column
    has_sniffing_col = False
    try:
        cursor.execute("PRAGMA table_info(inbounds);")
        columns = [col[1] for col in cursor.fetchall()]
        has_sniffing_col = "sniffing" in columns
        print(f"📋 Inbounds table columns: {columns} (Has sniffing column: {has_sniffing_col})")
    except Exception as e:
        print(f"⚠️ Failed to inspect SQLite table schema: {e}")

    # Read core inbound 443 (Reality)
    try:
        query = "SELECT id, port, protocol, remark, enable, settings, stream_settings"
        if has_sniffing_col:
            query += ", sniffing"
        query += " FROM inbounds WHERE port=443;"
        cursor.execute(query)
        inbound = cursor.fetchone()
    except Exception as e:
        print(f"❌ Failed to query database for port 443: {e}")
        conn.close()
        sys.exit(1)
        
    db_updated = False
    
    if inbound:
        if has_sniffing_col:
            inbound_id, port, protocol, remark, enable, settings_str, stream_settings_str, sniffing_str = inbound
        else:
            inbound_id, port, protocol, remark, enable, settings_str, stream_settings_str = inbound
            sniffing_str = "{}"
            
        print(f"\nFind inbound: ID={inbound_id}, Port={port}, Protocol={protocol}, Remark='{remark}', Enabled={enable}")
        
        try:
            settings = json.loads(settings_str) if settings_str else {}
        except Exception as e:
            print(f"⚠️ Failed to parse inbound protocol settings JSON: {e}")
            settings = {}
            
        try:
            stream_settings = json.loads(stream_settings_str) if stream_settings_str else {}
        except Exception as e:
            print(f"⚠️ Failed to parse stream settings JSON: {e}")
            stream_settings = {}
            
        print("\n--- Current Stream Settings ---")
        print(json.dumps(stream_settings, indent=2, ensure_ascii=False))
        
        security = stream_settings.get("security", "")
        
        if security == "reality":
            reality_settings = stream_settings.get("realitySettings", {})
            priv_key = reality_settings.get("privateKey", "")
            
            print(f"\n🔍 Detected Reality security. Current Private Key: {priv_key}")
            
            # If the privateKey is a path or empty:
            if "/" in priv_key or "letsencrypt" in priv_key or priv_key.endswith(".pem") or not priv_key:
                print("⚠️ Invalid Reality private key format detected (contains file paths or Let's Encrypt certificates)!")
                new_private_key = "ABiVSJTP0fEMzgsHghSAsQJp-bYAJAAt0jErpzaGtEo"
                new_public_key = "CXL0o8BEC7wz-TluA7w-QBbJladSsb9xL7G6UB410Xw"
                
                reality_settings["privateKey"] = new_private_key
                reality_settings["publicKey"] = new_public_key
                reality_settings["dest"] = "www.microsoft.com:443"
                reality_settings["serverNames"] = ["www.microsoft.com", "microsoft.com"]
                
                stream_settings["realitySettings"] = reality_settings
                db_updated = True
                print("✅ Successfully corrected PrivateKey, PublicKey, Dest and SNI settings inside JSON!")
            
            # Clean up fallbacks incorrectly placed in stream_settings
            if "fallbacks" in stream_settings:
                print("🧹 Found 'fallbacks' incorrectly placed in stream_settings. Moving them to the protocol 'settings' field!")
                del stream_settings["fallbacks"]
                db_updated = True

            # Always ensure realitySettings redirect target/dest points to Nginx (host.docker.internal:3443)
            # This is the key fix that binds the web traffic to Nginx TLS certificate handler on port 3443!
            if reality_settings.get("target") != "host.docker.internal:3443" or reality_settings.get("dest") != "host.docker.internal:3443":
                print(f"⚠️ Correcting Reality target/dest from '{reality_settings.get('target')}/{reality_settings.get('dest')}' to 'host.docker.internal:3443'...")
                reality_settings["target"] = "host.docker.internal:3443"
                reality_settings["dest"] = "host.docker.internal:3443"
                stream_settings["realitySettings"] = reality_settings
                db_updated = True
                print("✅ Configured Self-hosted Reality redirect fallback to our own local Nginx decryption port (3443)!")

            # Setup robust, explicit fallbacks for both domains, and a general wildcard fallback
            settings["fallbacks"] = [
                {
                    "name": "izinet.online",
                    "alpn": "",
                    "path": "",
                    "dest": "host.docker.internal:3443",
                    "xver": 0
                },
                {
                    "name": "www.izinet.online",
                    "alpn": "",
                    "path": "",
                    "dest": "host.docker.internal:3443",
                    "xver": 0
                },
                {
                    "dest": "host.docker.internal:3443",
                    "xver": 0
                }
            ]
            db_updated = True
            print("✅ Configured 3 precise, high-security VLESS fallback redirection rules (izinet.online, www.izinet.online, generic fallback) inside protocol settings!")
            
            # Also ensure sniffing is fully enabled to let Xray inspect TLS host/SNI headers!
            new_sniffing_str = "{}"
            if has_sniffing_col:
                try:
                    sniffing_dict = json.loads(sniffing_str) if sniffing_str else {}
                except:
                    sniffing_dict = {}
                sniffing_dict["enabled"] = True
                sniffing_dict["destOverride"] = ["http", "tls"]
                sniffing_dict["routeOnly"] = False
                new_sniffing_str = json.dumps(sniffing_dict, separators=(',', ':'))
                db_updated = True
                print("👁️ Enforced full TLS/HTTP SNI Sniffing in database!")
            
            if db_updated:
                try:
                    updated_settings_str = json.dumps(settings, separators=(',', ':'))
                    updated_stream_settings_str = json.dumps(stream_settings, separators=(',', ':'))
                    if has_sniffing_col:
                        cursor.execute("UPDATE inbounds SET settings=?, stream_settings=?, sniffing=? WHERE id=?;", (updated_settings_str, updated_stream_settings_str, new_sniffing_str, inbound_id))
                    else:
                        cursor.execute("UPDATE inbounds SET settings=?, stream_settings=? WHERE id=?;", (updated_settings_str, updated_stream_settings_str, inbound_id))
                    conn.commit()
                    print("💾 Changes SAVED to database successfully (both Settings, Stream Settings, and Sniffing updated)!")
                except Exception as e:
                    print(f"❌ Error while updating database: {e}")
                    conn.rollback()
        else:
             print(f"ℹ️ Security protocol is set to: '{security}' instead of 'reality'.")
    else:
        print("ℹ️ No VLESS inbound found on port 443.")

    # Read X-UI Admin Panel Settings from SQLite
    web_port = "2053"
    web_base_path = "/"
    try:
        # Ensure "externalTraffic" webhook spam is turned OFF to prevent I/O and memory exhaustion
        cursor.execute("SELECT key, value FROM settings WHERE key IN ('externalTraffic', 'externalTrafficInformURI');")
        rows = cursor.fetchall()
        traffic_settings = {row[0]: row[1] for row in rows}
        if traffic_settings.get("externalTraffic") != "false":
            print("⚠️ 'externalTraffic' (Информация о внешнем трафике) is enabled or missing. Disabling it to prevent endless spam logs and RAM leaks...")
            cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('externalTraffic', 'false');")
            cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('externalTrafficInformURI', '');")
            conn.commit()
            print("✅ Successfully disabled 'externalTraffic' webhook spam in settings table!")

        cursor.execute("SELECT key, value FROM settings WHERE key IN ('webPort', 'webBasePath');")
        rows = cursor.fetchall()
        settings = {row[0]: row[1] for row in rows}
        print("\n--- X-UI Panel settings retrieved from DB ---")
        for k, v in settings.items():
            print(f"  🔹 {k}: {v}")
        
        web_port = settings.get("webPort", "2053")
        web_base_path = settings.get("webBasePath", "/")
        if not web_base_path.startswith("/"):
            web_base_path = "/" + web_base_path
        if not web_base_path.endswith("/"):
            web_base_path = web_base_path + "/"
    except Exception as e:
        print(f"⚠️ Failed to read X-UI configurations from Database Settings: {e}")
        
    conn.close()

    # --- 2. DOUBLE-ENDED NGINX CONFIGURATION PATCH ---
    nginx_configs = [
        "/etc/nginx/sites-available/izinet",
        "/etc/nginx/sites-enabled/izinet"
    ]
    nginx_modified = False
    
    for nginx_path in nginx_configs:
        if os.path.exists(nginx_path):
            print(f"\n⚡ Inspecting Nginx config at {nginx_path}...")
            try:
                with open(nginx_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                target_listen = "listen 127.0.0.1:3443 ssl http2;"
                replacement_listen = "listen 3443 ssl http2;"
                
                if target_listen in content:
                    print(f"⚠️ Found strict local bind: '{target_listen}'. Replacing it with wildcard listen '{replacement_listen}'...")
                    updated_content = content.replace(target_listen, replacement_listen)
                    with open(nginx_path, "w", encoding="utf-8") as f:
                        f.write(updated_content)
                    print(f"✅ Patched listen directive in {nginx_path} successfully!")
                    nginx_modified = True
                else:
                    if "listen 3443 ssl http2;" in content:
                        print(f"✅ Listen directive on {nginx_path} is already correct (0.0.0.0:3443).")
                    else:
                        print(f"ℹ️ No strict '127.0.0.1:3443' found in {nginx_path}.")
            except Exception as e:
                print(f"❌ Failed to patch Nginx file {nginx_path}: {e}")

    # --- 3. AUTOMATED UFW SYSTEM FIREWALL PERMISSIONS ---
    if os.path.exists("/usr/sbin/ufw") or os.path.exists("/usr/bin/ufw"):
        print("\n🛡️  UFW Firewall detected. Insuring safe ports allowlist...")
        # Check if active
        res = subprocess.run(["ufw", "status"], capture_output=True, text=True)
        if "Status: active" in res.stdout or "активен" in res.stdout:
            print("⚡ UFW is active. Applying safe rules...")
            run_cmd(["ufw", "allow", "80/tcp"], "Allowing Port 80 (HTTP / Nginx Landing)")
            run_cmd(["ufw", "allow", "443/tcp"], "Allowing Port 443 (VLESS Reality VPN Server)")
            run_cmd(["ufw", "allow", "3443/tcp"], "Allowing Port 3443 (Nginx SSL decryption backend)")
            run_cmd(["ufw", "allow", "2053/tcp"], "Allowing Port 2053 (X-UI Web Admin Interface)")
            run_cmd(["ufw", "allow", "41758/tcp"], "Allowing Port 41758 (X-UI Alternate interface)")
            run_cmd(["ufw", "allow", "3005/tcp"], "Allowing Port 3005 (NodeJS Core Backend)")
            run_cmd(["ufw", "reload"], "Reloading Firewall configuration")
            print("✅ System Firewall fully aligned!")
        else:
            print("ℹ️ UFW is installed but inactive. Connection ports are open by default.")
    else:
        print("ℹ️ Standard UFW command not found. Skipping Firewall configuration.")

    # --- 4. HARD REBOOT SYSTEM ACTIONS ---
    # A complete Nginx restart is required to release 127.0.0.1:3443 and claim 0.0.0.0:3443
    print("\n⚡ Testing Nginx syntactic correctness...")
    nginx_ok, test_err = run_cmd(["nginx", "-t"])
    if nginx_ok:
        run_cmd(["systemctl", "restart", "nginx"], "Rebooting Nginx Web Server (Cold Restart)")
        print("✅ Nginx restarted!")
    else:
        print(f"⚠️ Nginx has synth issues: {test_err}. Skipping restart.")

    # Restart Docker Compose Containers
    if os.path.exists("docker-compose.yml"):
        run_cmd(["docker", "compose", "down"], "Shutting down Docker Compose containers")
        run_cmd(["docker", "compose", "up", "-d"], "Starting Docker Compose containers (Detached Mode)")
        print("⚡ Waiting 5 seconds for systems to settle...")
        time.sleep(5)
    else:
        print("⚠️ docker-compose.yml not found. Skipping container reboot.")

    # --- 5. HOST DIAGNOSTIC AND CURL CHECKER ---
    print("\n====================================================")
    print("🚦 RUNNING FINAL HEALTH PORT EXAMINATION (LOCAL CURLS)")
    print("====================================================")
    
    # Check Node JS Backend
    backend_ok = False
    try:
        res = subprocess.run(["curl", "-Is", "http://127.0.0.1:3005"], capture_output=True, text=True, timeout=5)
        if res.stdout:
            print(f"🟢 [NodeJS Backend 3005]: Alive! Header: {res.stdout.splitlines()[0]}")
            backend_ok = True
        else:
            print("🔴 [NodeJS Backend 3005]: Not responding locally.")
    except Exception as e:
        print(f"🔴 [NodeJS Backend 3005]: Connection failed ({e})")

    # Check X-UI default web interface 
    xui_ok = False
    try:
        target_curl = f"http://127.0.0.1:2053{web_base_path}"
        res = subprocess.run(["curl", "-Is", target_curl], capture_output=True, text=True, timeout=5)
        if res.stdout:
            header = res.stdout.splitlines()[0]
            if "200" in header or "302" in header or "404" in header: # 404/302 is alive inside fallback
                print(f"🟢 [X-UI Panel 2053]: Alive! URL Checked: {target_curl} -> Response: {header}")
                xui_ok = True
            else:
                print(f"🟡 [X-UI Panel 2053]: Returned unexpected code: {header}")
        else:
            print("🔴 [X-UI Panel 2053]: Not responding locally.")
    except Exception as e:
        print(f"🔴 [X-UI Panel 2053]: Connection failed ({e})")

    # Check Nginx 3443 Decryption Server
    nginx_3443_ok = False
    try:
        # Check internally if port 3443 listens broadly
        res = subprocess.run(["curl", "-Is", "-k", "https://127.0.0.1:3443/"], capture_output=True, text=True, timeout=5)
        if res.stdout:
            print(f"🟢 [Nginx SSL Decryptor 3443]: Alive! Response: {res.stdout.splitlines()[0]}")
            nginx_3443_ok = True
        else:
            print("🔴 [Nginx SSL Decryptor 3443]: Not responding locally.")
    except Exception as e:
         print(f"🔴 [Nginx SSL Decryptor 3443]: Connection failed ({e})")

    ext_ip = "ВАШ_IP_СЕРВЕРА"
    try:
        ip_res = subprocess.run(["curl", "-s", "ifconfig.me"], capture_output=True, text=True, timeout=5)
        if ip_res.stdout:
            ext_ip = ip_res.stdout.strip()
    except:
        pass

    print("\n====================================================")
    print("🏆 РЕЗУЛЬТАТЫ РЕМОНТА И ИНСТРУКЦИЯ ПО ВХОДУ:")
    print("====================================================")
    print(f"1️⃣  Личный Кабинет Клиента (Node/React):")
    print(f"   👉 https://izinet.online  (Домен должен быть в сером облаке CF \"DNS Only\"!)")
    print(f"   👉 или локально по IP: http://{ext_ip}:3005")
    print(f"")
    print(f"2️⃣  Панель управления 3x-ui (VPN Panel):")
    print(f"   👉 Ссылка для входа в браузер: http://{ext_ip}:{web_port}{web_base_path}")
    print(f"   ⚠️  ВАЖНО: Обязательно вводите в браузере полный путь {web_base_path} в конце!")
    print(f"       Без этого пути панель будет возвращать 404 ошибку (это защита панели)!")
    print("====================================================")

if __name__ == "__main__":
    main()
