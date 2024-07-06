HercDJCompact = function() {
    this.group = "[Master]";
};

HercDJCompact.init = function(id) {
    engine.setValue("[Master]", "num_samplers", 8);

    this.scratch = true;
    this.scratch_timer = [];
    this.scratch_timer_on = [];
    this.searchMode = false;
    this.shiftPressed = false;

    engine.connectControl("[Recording]", "status", "HercDJCompact.OnRecordingStatusChange");

    // Tell controller to send midi to update knob and slider positions.
    midi.sendShortMsg(0xB0, 0x7F, 0x7F);

    // But the rate values get messed up, so reset them
    engine.setValue("[Channel1]", "rate_set_default", 1.0);
    engine.setValue("[Channel2]", "rate_set_default", 1.0);
};

HercDJCompact.shutdown = function() {
    // toggle all lights off.
    for (i = 0x01; i < 0x57; i++) {
        midi.sendShortMsg(0x90, i, 0x00);
    }
};

HercDJCompact.controls = {
    // "name" is just for reference in the code.
    "inputs": {
        0x30: { "name": "jog", "channel": 1, "group": "[Channel1]" },
        0x31: { "name": "jog", "channel": 2, "group": "[Channel2]" },
        0x37: { "name": "pitch", "channel": 1, "group": "[Channel1]" },
        0x38: { "name": "pitch", "channel": 2, "group": "[Channel2]" },
        0x2D: { "name": "scratch_toggle", "channel": 1, "group": "[Master]" },
        0x2B: { "name": "rec_toggle", "channel": 1, "group": "[Master]" },
        0x22: { "name": "cue", "channel": 1, "group": "[Channel1]" },
        0x52: { "name": "cue", "channel": 2, "group": "[Channel2]" },
        0x2F: { "name": "shift", "channel": 1, "group": "[Master]" } // Added shift button mapping
    }
};

// Handle the shift button
HercDJCompact.shift = function(group, control, value, status) {
    this.shiftPressed = value > 0;
};

HercDJCompact.scratchToggle = function(group, control, value, status) {
    if (value > 0) {
        this.scratch = !this.scratch;
        if (this.scratch) {
            engine.scratchEnable(1, 256, 33 + 1 / 3, 1.0 / 8 * (0.500), (1.0 / 8) * (0.500) / 32);
            engine.scratchEnable(2, 256, 33 + 1 / 3, 1.0 / 8 * (0.500), (1.0 / 8) * (0.500) / 32);
        } else {
            engine.scratchDisable(1);
            engine.scratchDisable(2);
        }
    }
};

HercDJCompact.recToggle = function(group, control, value, status) {
    if (value > 0) {
        this.searchMode = !this.searchMode;
        if (this.searchMode) {
            print("Entering search mode");
        } else {
            print("Exiting search mode");
        }
    }
};

HercDJCompact.jog_wheel = function(group, control, value, status) {
    var input = HercDJCompact.controls.inputs[control];
    // If the high bit is 1, convert to a negative number
    if (value & 0x40) {
        value = value - 0x80;
    }
    if (this.searchMode) {
        if (value !== 0) {
            print("Scrolling through track list, value: " + value);
            engine.setValue("[Playlist]", "SelectTrackKnob", value);
        }
    } else {
        if (this.scratch) {
            if (value !== 0) {
                if (this.scratch_timer_on[input.channel]) {
                    engine.stopTimer(this.scratch_timer[input.channel]);
                    this.scratch_timer_on[input.channel] = false;
                }
                if (!engine.getValue(input.group, "scratch2_enable")) {
                    engine.scratchEnable(input.channel, 256, 33 + 1 / 3, 1.0 / 8 * (0.500), (1.0 / 8) * (0.500) / 32);
                } else {
                    engine.scratchTick(input.channel, value);
                }
            }

            if (engine.getValue(input.group, "scratch2_enable")) {
                // when not moved for 200 msecs, probably we are not touching the wheel anymore
                this.scratch_timer[input.channel] =
                    engine.beginTimer(200, () => this.jog_wheelhelper(input.channel), true);
                this.scratch_timer_on[input.channel] = true;
            }
        } else {
            if (value !== 0) {
                engine.setValue(input.group, "jog", value);
            }
        }
    }
};

HercDJCompact.cue = function(group, control, value, status) {
    print("Cue button pressed, control: " + control + ", value: " + value + ", searchMode: " + this.searchMode + ", shiftPressed: " + this.shiftPressed);

    // Determine the group based on the control value
    if (control === 0x22) {
        group = "[Channel1]";
    } else if (control === 0x52) {
        group = "[Channel2]";
    } else {
        print("Unknown control value: " + control);
        return;
    }

    print("Determined group: " + group);

    if (value > 0 && this.searchMode) {
        print("Loading track to deck, group: " + group);
        if (group === "[Channel1]") {
            engine.setValue("[Channel1]", "LoadSelectedTrack", 1);
        } else if (group === "[Channel2]") {
            engine.setValue("[Channel2]", "LoadSelectedTrack", 1);
        }
        // Confirm if the track was loaded
        print("Track loaded to deck: " + group);
        // Exit search mode after loading the track
        this.searchMode = false;
        print("Exiting search mode");
    } else if (value > 0 && this.shiftPressed) {
        print("Setting cue point, group: " + group);
        engine.setValue(group, "cue_default", value);
    } else if (value > 0) {
        print("Toggling headphone output, group: " + group);
        var currentHeadphone = engine.getValue(group, "pfl");
        engine.setValue(group, "pfl", !currentHeadphone);
    }
};

HercDJCompact.jog_wheelhelper = function(n) {
    engine.scratchDisable(n);
    this.scratch_timer_on[n] = false;
};

// Pitch is adjusted by holding down shift and turning the jog wheel.
HercDJCompact.pitch = function(group, control, value, status) {
    var input = HercDJCompact.controls.inputs[control];
    if (value & 0x40) {
        value = value - 0x80;
    }
    var delta = Math.pow(Math.abs(value), 2) / 1000.0;
    if (value < 0) {
        delta = -delta;
    }
    var pitch = engine.getValue(input.group, "rate") + delta;
    if (pitch > 1.0) {
        pitch = 1.0;
    }
    if (pitch < -1.0) {
        pitch = -1.0;
    }
    engine.setValue(input.group, "rate", pitch);
};

HercDJCompact.OnRecordingStatusChange = function(value, group, control) {
    // Not sure why this doesn't work with a regular midi output in the xml.
    if (value == 2) {
        midi.sendShortMsg(0x90, 0x2B, 0x7F);
        midi.sendShortMsg(0x90, 0x2C, 0x7F);
    } else {
        midi.sendShortMsg(0x90, 0x2B, 0x0);
        midi.sendShortMsg(0x90, 0x2C, 0x0);
    }
};
