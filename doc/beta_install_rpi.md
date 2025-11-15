How-to install the latest beta or dev tree (unstable) on your device?

This guide assumes you have a default install with default folders.
This is written for a RPI, jump to the section you need want to go to.
It is recommended to enable the Debug Log for this plugin in Server -> Plugin Config before updating.


# Backup old data
```
cp -a ~/.signalk ~/signalk-backup
```

# npmjs beta on RPI

## Install latest beta
```
cd ~.signalk

npm i @noforeignland/signalk-to-noforeignland@beta

sudo systemctl restart signalk.service && sudo journalctl -u signalk.service -f
```

## Install a specific beta
```
cd ~.signalk

# Here use the beta version you want to install
npm i @noforeignland/signalk-to-noforeignland@1.0.1-beta.5

sudo systemctl restart signalk.service && sudo journalctl -u signalk.service -f
```

--------------------------

# dev tree (unstable) - NOT RECOMMENDED
1. Backup old data

```
cd ~
cp -a .signalk/ signalk-backup
```

2.  Get new files from repo (main for latest)

```
cd ~
mkdir dev
cd dev
wget  https://github.com/noforeignland/nfl-signalk/archive/refs/heads/main.zip
unzip main.zip
cd nfl-signalk-main/
npm pack

cd ~/.signalk
npm install ~/dev/nfl-signalk-main/<your_npm_pack.tgz>
```

3.  Restart Server & Check logs

```
sudo systemctl restart signalk.service && sudo journalctl -u signalk.service -f
```

