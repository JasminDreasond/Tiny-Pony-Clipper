#include <napi.h>
#include <linux/uinput.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstring>
#include <map>
#include <vector>

/** @type {std::map<int, int>} */
std::map<int, int> active_pads;
/** @type {int} */
int next_pad_id = 1;

/**
 * @param {const Napi::CallbackInfo&} info
 * @returns {Napi::Value}
 */
Napi::Value SetupVirtualGamepad(const Napi::CallbackInfo& info) {
    /** @type {Napi::Env} */
    Napi::Env env = info.Env();
    /** @type {int} */
    int type = info[0].As<Napi::Number>().Int32Value(); // 0 = Xbox, 1 = DS4

    // REQUIRED: O_RDWR to read force feedback events from the OS
    /** @type {int} */
    int fd = open("/dev/uinput", O_RDWR | O_NONBLOCK);
    if (fd < 0) return Napi::Number::New(env, -1);

    // Enable key, absolute axis and synchronization events
    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_EVBIT, EV_ABS);
    ioctl(fd, UI_SET_EVBIT, EV_SYN);
    
    // REQUIRED: Tell the kernel this device supports Force Feedback
    ioctl(fd, UI_SET_EVBIT, EV_FF); 

    ioctl(fd, UI_SET_FFBIT, FF_RUMBLE);
    ioctl(fd, UI_SET_FFBIT, FF_PERIODIC);
    ioctl(fd, UI_SET_FFBIT, FF_SQUARE);
    ioctl(fd, UI_SET_FFBIT, FF_TRIANGLE);

    /** @type {std::vector<int>} */
    std::vector<int> buttons = { 
        BTN_SOUTH, BTN_EAST, BTN_NORTH, BTN_WEST,
        BTN_TL, BTN_TR, BTN_TL2, BTN_TR2,         
        BTN_SELECT, BTN_START, BTN_MODE,          
        BTN_THUMBL, BTN_THUMBR,
        BTN_DPAD_UP, BTN_DPAD_DOWN, BTN_DPAD_LEFT, BTN_DPAD_RIGHT,
    };
    
    for (int btn : buttons) ioctl(fd, UI_SET_KEYBIT, btn);

    /** @type {std::vector<int>} */
    std::vector<int> axes = { 
        ABS_X, ABS_Y, ABS_RX, ABS_RY,   
        ABS_Z, ABS_RZ,     
        ABS_HAT0X, ABS_HAT0Y 
    };

    for (int axis : axes) ioctl(fd, UI_SET_ABSBIT, axis);

    /** @type {struct uinput_user_dev} */
    struct uinput_user_dev uidev;
    memset(&uidev, 0, sizeof(uidev));
    
    // REQUIRED: Set the maximum simultaneous force feedback effects
    uidev.ff_effects_max = 16; 

    uidev.id.bustype = BUS_USB;
    uidev.id.version = 0x0111;

    if (type == 1) {
        snprintf(uidev.name, UINPUT_MAX_NAME_SIZE, "Tiny Pony DualShock 4");
        uidev.id.vendor  = 0x054C; // Sony
        uidev.id.product = 0x05C4; // DualShock 4
    } else {
        snprintf(uidev.name, UINPUT_MAX_NAME_SIZE, "Tiny Pony Xbox 360");
        uidev.id.vendor  = 0x045E; // Microsoft
        uidev.id.product = 0x028E; // Xbox 360 Controller
    }

    // Stick limits
    for (int axis : {ABS_X, ABS_Y, ABS_RX, ABS_RY}) {
        uidev.absmin[axis] = -32768;
        uidev.absmax[axis] = 32767;
        uidev.absflat[axis] = 128;
        uidev.absfuzz[axis] = 16;
    }

    // Triggers (0-255) 
    uidev.absmin[ABS_Z] = 0; uidev.absmax[ABS_Z] = 255;
    uidev.absmin[ABS_RZ] = 0; uidev.absmax[ABS_RZ] = 255;

    // D-Pad (-1, 0, 1)
    uidev.absmin[ABS_HAT0X] = -1; uidev.absmax[ABS_HAT0X] = 1;
    uidev.absmin[ABS_HAT0Y] = -1; uidev.absmax[ABS_HAT0Y] = 1;

    write(fd, &uidev, sizeof(uidev));
    ioctl(fd, UI_DEV_CREATE);

    /** @type {int} */
    int current_id = next_pad_id++;
    active_pads[current_id] = fd;

    return Napi::Number::New(env, current_id);
}

/**
 * Emits an input event.
 * @param {const Napi::CallbackInfo&} info
 * @returns {Napi::Value}
 */
Napi::Value EmitEvent(const Napi::CallbackInfo& info) {
    /** @type {Napi::Env} */
    Napi::Env env = info.Env();
    /** @type {int} */
    int id = info[0].As<Napi::Number>().Int32Value();
    
    if (active_pads.find(id) == active_pads.end()) return Napi::Boolean::New(env, false);
    /** @type {int} */
    int fd = active_pads[id];

    /** @type {struct input_event} */
    struct input_event ev;
    memset(&ev, 0, sizeof(ev));
    ev.type = info[1].As<Napi::Number>().Int32Value();
    ev.code = info[2].As<Napi::Number>().Int32Value();
    ev.value = info[3].As<Napi::Number>().Int32Value();

    write(fd, &ev, sizeof(ev));
    return Napi::Boolean::New(env, true);
}

/**
 * Destroys the virtual device.
 * @param {const Napi::CallbackInfo&} info
 * @returns {Napi::Value}
 */
Napi::Value DestroyVirtualGamepad(const Napi::CallbackInfo& info) {
    /** @type {Napi::Env} */
    Napi::Env env = info.Env();
    /** @type {int} */
    int id = info[0].As<Napi::Number>().Int32Value();

    if (active_pads.find(id) != active_pads.end()) {
        ioctl(active_pads[id], UI_DEV_DESTROY);
        close(active_pads[id]);
        active_pads.erase(id);
    }
    return Napi::Boolean::New(env, true);
}

/**
 * @param {Napi::Env} env
 * @param {Napi::Object} exports
 * @returns {Napi::Object}
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "setup"), Napi::Function::New(env, SetupVirtualGamepad));
    exports.Set(Napi::String::New(env, "emit"), Napi::Function::New(env, EmitEvent));
    exports.Set(Napi::String::New(env, "destroy"), Napi::Function::New(env, DestroyVirtualGamepad));
    return exports;
}

NODE_API_MODULE(uinput_gamepad, Init)