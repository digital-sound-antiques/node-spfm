# node-spfm

A command-line controller for [SPFM-Light](http://www.pyonpyon.jp/~gasshi/fm/spfmlight.html).

![](./images/node-spfm.png)

This screen shot is node-spfm running under [cool-retro-term](https://github.com/Swordfish90/cool-retro-term).

# Requirements
- Node 10 or later environment on macOS and Linux is required. 
- SPFM Light device.

This program works also on Windows 10 with proper console (ex. bash console in Visual Studio Code), however, playback speed is not stabilized.

# Supported File Types

- Video Game Music Files (.vgm, .vgz)
- KSS Files (.kss)                    
- MGSDRV Files (.mgs)                 
- MuSICA / Kinrou5 Files (.bgm)       
- MPK Files (.mpk)                    
- OPLL Driver Files (.opx)            
- M3U Playlist

# Supported Modules

- AY-3-8910 (PSG)  
- YM2203 (OPN)    
- YM2608 (OPNA)   
- YM2413 (OPLL)   
- YM3526 (OPL)    
- YM3812 (OPL2)  

# Install

Node.js 10 or later is required.

```sh
npm install -g node-spfm
```

# Usage

```sh
SYNOPSIS

  spfm play [<option>] <file> 
  spfm devices [-l]           
  spfm config                 

COMMANDS

  play      Play music files.          
  devices   Show connected devices.    
  config    Interactive configuration. 

See 'spfm <command> --help' to read about a specific command usage.
```

# Keys
- Cursor Left/Right - Down/Up playback speed. 
- Cursor Down - Reset playback speed.       
- R - Restart current Track                   
- PageUp/B - Previous Track                   
- PageDown/N - Next Track        

