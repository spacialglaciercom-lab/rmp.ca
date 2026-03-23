import pexpect
import sys

def run_ssh_commands(host, username, password, commands):
    child = pexpect.spawn(f'ssh -o StrictHostKeyChecking=no {username}@{host}', encoding='utf-8', timeout=120)
    
    try:
        idx = child.expect(['Password:', 'password:', pexpect.EOF, pexpect.TIMEOUT])
        if idx in [0, 1]:
            child.sendline(password)
        elif idx == 2:
            print("EOF before password prompt:", child.before)
            return
        elif idx == 3:
            print("TIMEOUT before password prompt:", child.before)
            return
            
        # Expect root prompt
        child.expect(r'# ')
        
        # Turn off echo if possible, or just send commands
        for cmd in commands:
            print(f"=== RUNNING: {cmd} ===")
            child.sendline(cmd)
            # wait for prompt again
            child.expect(r'# ')
            # The output will include the command echoed back and the output
            out = child.before
            print(out.strip())
            print(f"EXIT CODE: N/A\n")
            
        # exit
        child.sendline('exit')
        child.expect(pexpect.EOF)
        
    except pexpect.ExceptionPexpect as e:
        print(f"EXPECT ERROR: {e}")
        print("Output before error:", child.before)

if __name__ == '__main__':
    commands = sys.argv[1:]
    if not commands:
        print("No commands provided.")
        sys.exit(1)
    run_ssh_commands('192.168.122.187', 'root', 'REDACTED_SSH_PASSWORD', commands)
