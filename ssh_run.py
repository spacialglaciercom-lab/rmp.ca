import paramiko
import sys

def run_ssh_commands(host, username, password, commands):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(hostname=host, username=username, password=password)
        for cmd in commands:
            print(f"=== RUNNING: {cmd} ===")
            stdin, stdout, stderr = client.exec_command(cmd)
            exit_status = stdout.channel.recv_exit_status()
            out = stdout.read().decode('utf-8')
            err = stderr.read().decode('utf-8')
            if out:
                print(out.strip())
            if err:
                print("ERROR:", err.strip())
            print(f"EXIT CODE: {exit_status}\n")
    except Exception as e:
        print(f"CONNECTION ERROR: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    commands = sys.argv[1:]
    if not commands:
        print("No commands provided.")
        sys.exit(1)
    run_ssh_commands('192.168.122.187', 'root', 'REDACTED_SSH_PASSWORD', commands)
