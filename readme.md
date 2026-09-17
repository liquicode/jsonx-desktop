# jsonx desktop

The jsonx application as a desktop program: open a `.jsonx` file and work on it in a window.

It is [jsonx-cli](https://github.com/liquicode/jsonx-cli)'s Web UI in a window, so everything you can do
there you can do here. What the desktop adds is the operating system: opening and saving files, the files
you opened lately, the `.jsonx` file association, and notifications.


## Installing

Run the installer, `jsonx Setup <version>.exe`. It installs for you alone, so it needs no administrator,
and you can choose the folder. It is not signed yet, so Windows SmartScreen warns before it runs: choose
*More info*, then *Run anyway*.

Windows installers are built today. macOS and Linux are not.


## Opening a file

Double click a `.jsonx` file, or start jsonx and use *Open file*. Started with no file, it shows the
files you opened lately.

***Each open file is its own window***, and each window runs its own `jsonx` process holding that file.
So two files never share anything, and closing a window closes the file it holds. Opening a file which is
already open brings its window forward.

*File > Open Recent* lists the last ten files, newest first; a file which is no longer on disk drops off
the list. *Clear* forgets them.


## The window

The window is the [Web UI](https://github.com/liquicode/jsonx-cli#the-web-ui): Inventory, Input, Log and
Data Rows, with the same keys, themes and text sizes. Two buttons in its header are the desktop's:

- ***Open file*** asks for a `.jsonx` file and opens it in its own window.
- ***Terminal*** opens the [jsonx terminal](https://github.com/liquicode/jsonx-cli#the-jsonx-terminal) on
  this file's process, in a window beside it. What you type there and what the window shows are the same
  session. It runs jsonx commands and is not a system shell.

*Copy* and *Save* in a row's JSON, and *Save as JSON* on Data Rows, use the desktop's own dialogs. A
command which finishes while the window is in the background tells you through a notification.


## What comes with it

Every [jsonstor adapter](https://github.com/liquicode/jsonstor) is installed with the program, so a file
which names any of them opens with nothing else to install. Data sources which reach a server — MongoDB,
PostgreSQL, Redis and the rest — still need that server.


## Building it yourself

```
npm install
npm test
npm run build
```

`npm test` drives the real application, so it needs the Electron it installs. `npm run build` writes an
installer to `dist`.

If the build stops with `EPERM` or `EBUSY` on a file it has just written, an antivirus scanner is holding
it. Exclude the folder you build in, or build somewhere else:

```
npx electron-builder --win "-c.directories.output=C:\some\other\folder"
```
