# Bilibili Mini Speed Controller

A Tampermonkey userscript for flexible playback speed control on Bilibili.

Current version: `v1.0.0`

## Features

- Small floating speed panel on Bilibili video pages
- Immediate speed changes with no confirm button
- Preset speed dropdown
- Remembers your last playback speed
- Remembers panel position
- Enhances Bilibili's native right-arrow hold behavior
- Optional left-arrow hold slowdown mode

## What It Does

This userscript adds a compact floating playback-speed controller to Bilibili.

You can:

- type a custom speed directly
- choose from common preset speeds
- drag the panel anywhere on the page
- keep your preferred speed across sessions

It also enhances keyboard behavior:

- `Right Arrow` keeps Bilibili's native temporary high-speed flow, but adjusts the temporary speed when your base speed is already high
- `Left Arrow` can optionally be repurposed into a temporary slowdown feature

## Supported Pages

- `https://www.bilibili.com/video/*`
- `https://www.bilibili.com/bangumi/play/*`

## Installation

### Requirements

- [Tampermonkey](https://www.tampermonkey.net/)

### Install Script

1. Open the Tampermonkey dashboard.
2. Create a new script.
3. Replace the default template with the contents of [bilibili-mini-speed.user.js](C:\Users\zly\Desktop\tampermonkey\bilibili-mini-speed-controller\bilibili-mini-speed.user.js).
4. Save the script.
5. Refresh a Bilibili video page.

## Usage

### Speed Panel

The floating panel includes:

- a speed label
- a numeric input
- a small preset dropdown button
- a checkbox labeled `左键降速`

### Change Speed

You can change playback speed by:

- typing a value directly into the input
- using the input's step controls
- selecting a preset speed from the dropdown

Changes apply immediately.

### Preset Speeds

Built-in presets:

- `0.5`
- `0.75`
- `1`
- `1.25`
- `1.5`
- `2`
- `2.5`
- `3`
- `3.5`
- `4`
- `4.5`
- `5`
- `5.5`

### Drag the Panel

Drag the panel by holding its empty area.

The script remembers the position automatically.

## Keyboard Behavior

### Right Arrow

This script does **not** replace Bilibili's native right-arrow hold logic.

Instead, it hooks into the native temporary speed-up flow and adjusts the temporary rate.

Native Bilibili behavior:

- hold `Right Arrow`
- after a short delay, the player enters temporary `3x`
- release the key to restore the original speed

Enhanced behavior:

- base speed below `3x`: stays native, temporary `3x`
- base speed at `3x`: temporary `4x`
- base speed above `3x`: temporary `base speed + 1`

Examples:

- `3x` -> hold right -> temporary `4x`
- `4x` -> hold right -> temporary `5x`
- `5.5x` -> hold right -> temporary `6.5x`

### Left Arrow

Left-arrow slowdown is **optional**.

It is only enabled when the `左键降速` checkbox is checked.

This behavior is **not** based on Bilibili's native left-arrow hold behavior.

Bilibili's native left-arrow hold behavior is closer to continuous seek / progress control, not temporary slowdown.

When enabled, this script takes over left-arrow behavior:

- tap `Left Arrow`: seek backward `5` seconds
- hold `Left Arrow`: temporary slowdown
- release `Left Arrow`: restore the original playback speed

Slowdown rules:

- base speed below `3x`: reduce by `0.5x`
- base speed at or above `3x`: reduce by `1x`

Examples:

- `2x` -> hold left -> temporary `1.5x`
- `2.5x` -> hold left -> temporary `2x`
- `3x` -> hold left -> temporary `2x`
- `4x` -> hold left -> temporary `3x`

## Persistent Settings

The script stores the following in `localStorage`:

- last selected playback speed
- panel position
- whether left-arrow slowdown is enabled

Storage keys:

- `tm-bilibili-mini-speed-rate`
- `tm-bilibili-mini-speed-position`
- `tm-bilibili-mini-speed-left-hold-enabled`

## Notes

### Player Focus

Keyboard controls only work when the player has focus.

If arrow-key behavior does not respond:

1. click the video area once
2. try again

### Editable Areas

To avoid interfering with typing, the script does not trigger arrow-key temporary speed logic inside editable elements such as:

- text inputs
- textareas
- comment boxes
- contenteditable areas

### Speed Limits

Playback speed is clamped to:

- minimum `0.1x`
- maximum `16x`

### Compatibility

The right-arrow enhancement depends on Bilibili's current native temporary `3x` player flow.

If Bilibili changes its player internals, this part may need future updates.

## Files

- [bilibili-mini-speed.user.js](C:\Users\zly\Desktop\tampermonkey\bilibili-mini-speed-controller\bilibili-mini-speed.user.js)
- [README.md](C:\Users\zly\Desktop\tampermonkey\bilibili-mini-speed-controller\README.md)

