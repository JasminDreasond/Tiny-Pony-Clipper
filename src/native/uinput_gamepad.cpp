#include <napi.h>
#include <linux/uinput.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstring>

int uinput_fd = -1;

Napi::Value SetupVirtualGamepad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    uinput_fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (uinput_fd < 0) return Napi::Boolean::New(env, false);

    ioctl(uinput_fd, UI_SET_EVBIT, EV_KEY);
    ioctl(uinput_fd, UI_SET_EVBIT, EV_ABS);
    ioctl(uinput_fd, UI_SET_EVBIT, EV_SYN);

    // Setup standard Gamepad Buttons
    int buttons[] = { 
        BTN_A, BTN_B, BTN_X, BTN_Y, 
        BTN_TL, BTN_TR, BTN_TL2, BTN_TR2, 
        BTN_SELECT, BTN_START, BTN_THUMBL, BTN_THUMBR, 
        BTN_DPAD_UP, BTN_DPAD_DOWN, BTN_DPAD_LEFT, BTN_DPAD_RIGHT, BTN_MODE 
    };
    
    for (int btn : buttons) {
        ioctl(uinput_fd, UI_SET_KEYBIT, btn);
    }

    // Setup Analog Axes
    int axes[] = { ABS_X, ABS_Y, ABS_RX, ABS_RY, ABS_Z, ABS_RZ, ABS_HAT0X, ABS_HAT0Y };
    for (int axis : axes) {
        ioctl(uinput_fd, UI_SET_ABSBIT, axis);
    }

    struct uinput_user_dev uidev;
    memset(&uidev, 0, sizeof(uidev));
    snprintf(uidev.name, UINPUT_MAX_NAME_SIZE, "Tiny Pony Virtual Gamepad");
    uidev.id.bustype = BUS_USB;
    uidev.id.vendor  = 0x045e; // Microsoft
    uidev.id.product = 0x028e; // Xbox 360 Controller
    uidev.id.version = 1;

    // Define analog stick ranges (-32768 to 32767)
    uidev.absmin[ABS_X] = -32768; uidev.absmax[ABS_X] = 32767;
    uidev.absmin[ABS_Y] = -32768; uidev.absmax[ABS_Y] = 32767;
    uidev.absmin[ABS_RX] = -32768; uidev.absmax[ABS_RX] = 32767;
    uidev.absmin[ABS_RY] = -32768; uidev.absmax[ABS_RY] = 32767;
    
    // Define triggers range (0 to 255)
    uidev.absmin[ABS_Z] = 0; uidev.absmax[ABS_Z] = 255;
    uidev.absmin[ABS_RZ] = 0; uidev.absmax[ABS_RZ] = 255;

    write(uinput_fd, &uidev, sizeof(uidev));
    ioctl(uinput_fd, UI_DEV_CREATE);

    return Napi::Boolean::New(env, true);
}

Napi::Value EmitEvent(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (uinput_fd < 0) return Napi::Boolean::New(env, false);

    int type = info[0].As<Napi::Number>().Int32Value();
    int code = info[1].As<Napi::Number>().Int32Value();
    int val = info[2].As<Napi::Number>().Int32Value();

    struct input_event ev;
    memset(&ev, 0, sizeof(ev));
    ev.type = type;
    ev.code = code;
    ev.value = val;

    write(uinput_fd, &ev, sizeof(ev));
    return Napi::Boolean::New(env, true);
}

Napi::Value DestroyVirtualGamepad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (uinput_fd >= 0) {
        ioctl(uinput_fd, UI_DEV_DESTROY);
        close(uinput_fd);
        uinput_fd = -1;
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