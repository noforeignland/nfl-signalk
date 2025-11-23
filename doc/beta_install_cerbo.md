How-to install the latest beta or dev tree (unstable) on your device?

This guide assumes you have a default install with default folders.
This is written for a Victron Cerbo GX jump to the section you need want to go to.
It is recommended to enable the Debug Log for this plugin in Server -> Plugin Config before updating.


# Pre-requirements
On the Cerbo GUI enable SSH access and set a afmin password
Windows User: Download putty (for ssh) and Winscp (for secure fie copy)

## On GUI v1:
1. Click "Menu" (bottom right)
2. Settings > General
3. Set root password
4. Enable "SSH on LAN"

## On GUI v2:
1. Settings -> General
2. Set root password
3. Enable "SSH on LAN"


# Backup old data

## BEST + SLOW: Full signalk copy to local computer 
1. Connect your Cerbo with WinSCP
2. Copy the folder "/data/conf/signalk" to your local PC

## Alternative Cerbo has a SD Card connected:
1.  ssh to the Cerbo
```
df -h
   # showns for me that /dev/mmcblk0p1 has 29GB free and is mounted to /run/media/mmcblk0p1
   # This is a SD card that is manually inserted. 

mount 
   # confirms this for me with output:
   # /dev/mmcblk0p1 on /run/media/mmcblk0p1 type vfat (rw,relatime,fmask=0022,dmask=0022,codepage=437,iocharset=iso8859-1,shortname=mixed,errors=remount-ro)

cp -r /data/conf/signalk /run/media/mmcblk0p1/signalk-backup
   # copies the files for you, it will take some time, as the CPU and IO are not the fastest

ls –la  /run/media/mmcblk0p1/signalk-backup
   # Verify that folder and files exist.
```


# npmjs beta on Cerbo

## Install latest beta
1. SSH to the Cerbo:
```
cd /data/conf/signalk

npm i @noforeignland/signalk-to-noforeignland@beta

# reset owner properly, else package belongs to root
chown -R signalk:signalk /data/conf/signalk/*

```

2. Restart Server & Check logs
```
 svc -t /service/signalk-server
```


## Install specific beta version f.e. 1.0.1-beta.5
1. SSH to the Cerbo:
```
cd /data/conf/signalk

# Here use the beta version you want to install
npm i @noforeignland/signalk-to-noforeignland@1.0.1-beta.5

# reset owner properly, else package belongs to root
chown -R signalk:signalk /data/conf/signalk/*

```
2. Restart Server & Check logs
```
 svc -t /service/signalk-server
```


# dev tree (unstable) install - NOT RECOMMENDED

1. Backup as above 

2. Get new files from repo (main for latest)

```
cd ~
mkdir dev
cd dev
wget  https://github.com/noforeignland/nfl-signalk/archive/refs/heads/main.zip
unzip main.zip
cd nfl-signalk-main/
npm pack

cd /data/conf/signalk
npm install ~/dev/nfl-signalk-main/<your_npm_pack.tgz>

# reset owner properly, else package belongs to root
chown -R signalk:signalk /data/conf/signalk/*

```

3. Restart Server & Check logs
```
svc -t /service/signalk-server
```

# Manual Fixes

## WARNING: found multiple copies of plugin with id signalk-to-noforeignland at /data/conf/signalk/node_modules/ and /data/conf/signalk/node_modules/

```
cd /data/conf/signalk && npm uninstall signalk-to-noforeignland signalk-to-nfl
```

and than

```
svc -t /service/signalk-server
```