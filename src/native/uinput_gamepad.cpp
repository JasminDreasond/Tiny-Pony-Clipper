#include <napi.h>
#include <linux/uinput.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstring>
#include <map>

std::map<int, int> active_pads;
int next_pad_id = 1;

Napi::Value SetupVirtualGamepad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    int type = info[0].As<Napi::Number>().Int32Value(); // 0 = Xbox, 1 = DualShock 4

    int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0) return Napi::Number::New(env, -1);

    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_EVBIT, EV_ABS);
    ioctl(fd, UI_SET_EVBIT, EV_SYN);

    // Setup standard Gamepad Buttons
    int buttons[] = { 
        BTN_A, BTN_B, BTN_X, BTN_Y, 
        BTN_TL, BTN_TR, BTN_TL2, BTN_TR2, 
        BTN_SELECT, BTN_START, BTN_THUMBL, BTN_THUMBR, 
        BTN_DPAD_UP, BTN_DPAD_DOWN, BTN_DPAD_LEFT, BTN_DPAD_RIGHT, BTN_MODE 
    };
    
    for (int btn : buttons) ioctl(fd, UI_SET_KEYBIT, btn);

    // Setup Analog Axes
    int axes[] = { ABS_X, ABS_Y, ABS_RX, ABS_RY, ABS_Z, ABS_RZ, ABS_HAT0X, ABS_HAT0Y };
    for (int axis : axes) ioctl(fd, UI_SET_ABSBIT, axis);

    struct uinput_user_dev uidev;
    memset(&uidev, 0, sizeof(uidev));
    
    uidev.id.bustype = BUS_USB;
    uidev.id.version = 1;

    if (type == 1) {
        snprintf(uidev.name, UINPUT_MAX_NAME_SIZE, "Tiny Pony DualShock 4");
        uidev.id.vendor  = 0x054C; // Sony
        uidev.id.product = 0x05C4; // DualShock 4
    } else {
        snprintf(uidev.name, UINPUT_MAX_NAME_SIZE, "Tiny Pony Xbox Pad");
        uidev.id.vendor  = 0x045E; // Microsoft
        uidev.id.product = 0x028E; // Xbox 360 Controller
    }

    uidev.absmin[ABS_X] = -32768; uidev.absmax[ABS_X] = 32767;
    uidev.absmin[ABS_Y] = -32768; uidev.absmax[ABS_Y] = 32767;
    uidev.absmin[ABS_RX] = -32768; uidev.absmax[ABS_RX] = 32767;
    uidev.absmin[ABS_RY] = -32768; uidev.absmax[ABS_RY] = 32767;
    
    // Define triggers range (0 to 255)
    uidev.absmin[ABS_Z] = 0; uidev.absmax[ABS_Z] = 255;
    uidev.absmin[ABS_RZ] = 0; uidev.absmax[ABS_RZ] = 255;

    write(fd, &uidev, sizeof(uidev));
    ioctl(fd, UI_DEV_CREATE);

    int current_id = next_pad_id++;
    active_pads[current_id] = fd;

    return Napi::Number::New(env, current_id);
}

Napi::Value EmitEvent(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int id = info[0].As<Napi::Number>().Int32Value();
    
    if (active_pads.find(id) == active_pads.end()) return Napi::Boolean::New(env, false);
    int fd = active_pads[id];

    int type = info[1].As<Napi::Number>().Int32Value();
    int code = info[2].As<Napi::Number>().Int32Value();
    int val = info[3].As<Napi::Number>().Int32Value();

    struct input_event ev;
    memset(&ev, 0, sizeof(ev));
    ev.type = type;
    ev.code = code;
    ev.value = val;

    write(fd, &ev, sizeof(ev));
    return Napi::Boolean::New(env, true);
}

Napi::Value DestroyVirtualGamepad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int id = info[0].As<Napi::Number>().Int32Value();

    if (active_pads.find(id) != active_pads.end()) {
        ioctl(active_pads[id], UI_DEV_DESTROY);
        close(active_pads[id]);
        active_pads.erase(id);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "setup"), Napi::Function::New(env, SetupVirtualGamepad));
    exports.Set(Napi::String::New(env, "emit"), Napi::Function::New(env, EmitEvent));
    exports.Set(Napi::String::New(env, "destroy"), Napi::Function::New(env, DestroyVirtualGamepad));
    return exports;
}

NODE_API_MODULE(uinput_gamepad, Init)