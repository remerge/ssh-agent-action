const core = require('@actions/core');
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const tiny = require('tiny-json-http')
const { homePath, sshAgentCmdDefault, sshAddCmdDefault, gitCmdDefault } = require('./paths.js');

try {
    const privateKey = core.getInput('ssh-private-key');

    const sshAgentCmdInput = core.getInput('ssh-agent-cmd');
    const sshAddCmdInput = core.getInput('ssh-add-cmd');
    const gitCmdInput = core.getInput('git-cmd');

    const sshAgentCmd = sshAgentCmdInput ? sshAgentCmdInput : sshAgentCmdDefault;
    const sshAddCmd = sshAddCmdInput ? sshAddCmdInput : sshAddCmdDefault;
    const gitCmd = gitCmdInput ? gitCmdInput : gitCmdDefault;

    if (!privateKey) {
        core.setFailed("The ssh-private-key argument is empty. Maybe the secret has not been configured, or you are using a wrong secret name in your workflow file.");
        return;
    }

    const homeSsh = homePath + '/.ssh';
    fs.mkdirSync(homeSsh, { recursive: true });

    console.log("Adding github.com to known_hosts");
    const knownHostsFile = homeSsh + '/known_hosts';
    const meta = JSON.parse(execSync(`curl -sL https://api.github.com/meta`));
    meta.ssh_keys.forEach(function(key) {
        console.log(key);
        fs.appendFileSync(knownHostsFile, 'github.com ' + key + '\n');
    });
    fs.chmodSync(knownHostsFile, '644');

    console.log("Starting ssh-agent");
    const authSock = core.getInput('ssh-auth-sock');
    const sshAgentArgs = (authSock && authSock.length > 0) ? ['-a', authSock] : [];

    // Extract auth socket path and agent pid and set them as job variables
    execFileSync(sshAgentCmd, sshAgentArgs).toString().split("\n").forEach(function(line) {
        const matches = /^(SSH_AUTH_SOCK|SSH_AGENT_PID)=(.*); export \1/.exec(line);

        if (matches && matches.length > 0) {
            // This will also set process.env accordingly, so changes take effect for this script
            core.exportVariable(matches[1], matches[2])
            console.log(`${matches[1]}=${matches[2]}`);
        }
    });

    console.log("Adding private key(s) to agent");
    privateKey.split(/(?=-----BEGIN)/).forEach(function(key) {
        execFileSync(sshAddCmd, ['-'], { input: key.trim() + "\n" });
    });

    console.log("Key(s) added:");
    execFileSync(sshAddCmd, ['-l'], { stdio: 'inherit' });

    console.log("Redirecting git commands to use ssh");
    execSync(`${gitCmd} config --global --replace-all url."git@github.com:".insteadOf "https://github.com/"`);

} catch (error) {

    if (error.code == 'ENOENT') {
        console.log(`The '${error.path}' executable could not be found. Please make sure it is on your PATH and/or the necessary packages are installed.`);
        console.log(`PATH is set to: ${process.env.PATH}`);
    }

    core.setFailed(error.message);
}
