#include <napi.h>
#include <windows.h>
#include <ViGEm/Client.h>
#include <map>

#pragma region "Linux Event Macros"
#define EV_SYN 0x00
#define EV_KEY 0x01
#define EV_ABS 0x03

#define BTN_SOUTH 0x130
#define BTN_EAST 0x131
#define BTN_NORTH 0x133
#define BTN_WEST 0x134
#define BTN_TL 0x136
#define BTN_TR 0x137
#define BTN_SELECT 0x13a
#define BTN_START 0x13b
#define BTN_MODE 0x13c
#define BTN_THUMBL 0x13d
#define BTN_THUMBR 0x13e

#define ABS_X 0x00
#define ABS_Y 0x01
#define ABS_Z 0x02
#define ABS_RX 0x03
#define ABS_RY 0x04
#define ABS_RZ 0x05
#define ABS_HAT0X 0x10
#define ABS_HAT0Y 0x11
#pragma endregion

struct VirtualPad {
    PVIGEM_TARGET target;
    int type; // 0 = Xbox, 1 = DS4
    XUSB_REPORT xboxReport;
    DS4_REPORT ds4Report;
    int hatX;
    int hatY;
};

/** @type {std::map<int, VirtualPad>} */
std::map<int, VirtualPad> active_pads;
/** @type {int} */
int next_pad_id = 1;
/** @type {PVIGEM_CLIENT} */
PVIGEM_CLIENT client = nullptr;

/**
 * Toggles a specific bit mask for button states.
 */
template <typename T, typename U>
inline void SetBit(T& mask, U flag, bool enable) {
    if (enable) mask |= flag;
    else mask &= ~flag;
}

void UpdateButtons(VirtualPad& pad, int code, int value) {
    bool pressed = (value != 0);
    
    if (pad.type == 0) { // Xbox
        switch(code) {
            case BTN_SOUTH: SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_A, pressed); break;
            case BTN_EAST:  SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_B, pressed); break;
            case BTN_WEST:  SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_X, pressed); break;
            case BTN_NORTH: SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_Y, pressed); break;
            case BTN_TL:    SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_LEFT_SHOULDER, pressed); break;
            case BTN_TR:    SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_RIGHT_SHOULDER, pressed); break;
            case BTN_SELECT:SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_BACK, pressed); break;
            case BTN_START: SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_START, pressed); break;
            case BTN_MODE:  SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_GUIDE, pressed); break;
            case BTN_THUMBL:SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_LEFT_THUMB, pressed); break;
            case BTN_THUMBR:SetBit(pad.xboxReport.wButtons, XUSB_GAMEPAD_RIGHT_THUMB, pressed); break;
        }
    } else { // DS4
        switch(code) {
            case BTN_SOUTH: SetBit(pad.ds4Report.wButtons, DS4_BUTTON_CROSS, pressed); break;
            case BTN_EAST:  SetBit(pad.ds4Report.wButtons, DS4_BUTTON_CIRCLE, pressed); break;
            case BTN_WEST:  SetBit(pad.ds4Report.wButtons, DS4_BUTTON_SQUARE, pressed); break;
            case BTN_NORTH: SetBit(pad.ds4Report.wButtons, DS4_BUTTON_TRIANGLE, pressed); break;
            case BTN_TL:    SetBit(pad.ds4Report.wButtons, DS4_BUTTON_SHOULDER_LEFT, pressed); break;
            case BTN_TR:    SetBit(pad.ds4Report.wButtons, DS4_BUTTON_SHOULDER_RIGHT, pressed); break;
            case BTN_SELECT:SetBit(pad.ds4Report.wButtons, DS4_BUTTON_SHARE, pressed); break;
            case BTN_START: SetBit(pad.ds4Report.wButtons, DS4_BUTTON_OPTIONS, pressed); break;
            case BTN_MODE:  SetBit(pad.ds4Report.bSpecial, DS4_SPECIAL_BUTTON_PS, pressed); break;
            case BTN_THUMBL:SetBit(pad.ds4Report.wButtons, DS4_BUTTON_THUMB_LEFT, pressed); break;
            case BTN_THUMBR:SetBit(pad.ds4Report.wButtons, DS4_BUTTON_THUMB_RIGHT, pressed); break;
        }
    }
}

void UpdateAxes(VirtualPad& pad, int code, int value) {
    if (code == ABS_HAT0X) { pad.hatX = value; return; }
    if (code == ABS_HAT0Y) { pad.hatY = value; return; }

    if (pad.type == 0) { // Xbox
        // Inverting Y/RY because Windows Xbox standard is inverted compared to Linux
        switch(code) {
            case ABS_X:  pad.xboxReport.sThumbLX = (SHORT)value; break;
            case ABS_Y:  pad.xboxReport.sThumbLY = (SHORT)-value; break; 
            case ABS_RX: pad.xboxReport.sThumbRX = (SHORT)value; break;
            case ABS_RY: pad.xboxReport.sThumbRY = (SHORT)-value; break;
            case ABS_Z:  pad.xboxReport.bLeftTrigger = (UCHAR)value; break;
            case ABS_RZ: pad.xboxReport.bRightTrigger = (UCHAR)value; break;
        }
    } else { // DS4
        // Translate Linux (-32768 to 32767) to DS4 (0 to 255)
        UCHAR mapped = (UCHAR)((value + 32768) / 256);
        switch(code) {
            case ABS_X:  pad.ds4Report.bThumbLX = mapped; break;
            case ABS_Y:  pad.ds4Report.bThumbLY = mapped; break; 
            case ABS_RX: pad.ds4Report.bThumbRX = mapped; break;
            case ABS_RY: pad.ds4Report.bThumbRY = mapped; break;
            case ABS_Z:  pad.ds4Report.bTriggerL = (UCHAR)value; break;
            case ABS_RZ: pad.ds4Report.bTriggerR = (UCHAR)value; break;
        }
    }
}

void SyncReport(VirtualPad& pad) {
    if (pad.type == 0) { // Xbox DPAD
        pad.xboxReport.wButtons &= ~(XUSB_GAMEPAD_DPAD_UP | XUSB_GAMEPAD_DPAD_DOWN | XUSB_GAMEPAD_DPAD_LEFT | XUSB_GAMEPAD_DPAD_RIGHT);
        if (pad.hatY == -1) pad.xboxReport.wButtons |= XUSB_GAMEPAD_DPAD_UP;
        if (pad.hatY == 1)  pad.xboxReport.wButtons |= XUSB_GAMEPAD_DPAD_DOWN;
        if (pad.hatX == -1) pad.xboxReport.wButtons |= XUSB_GAMEPAD_DPAD_LEFT;
        if (pad.hatX == 1)  pad.xboxReport.wButtons |= XUSB_GAMEPAD_DPAD_RIGHT;
        
        vigem_target_x360_update(client, pad.target, pad.xboxReport);
    } else { // DS4 DPAD
        DS4_DPAD_DIRECTIONS dpad = DS4_BUTTON_DPAD_NONE;
        if (pad.hatY == -1 && pad.hatX == -1) dpad = DS4_BUTTON_DPAD_NORTHWEST;
        else if (pad.hatY == -1 && pad.hatX == 1) dpad = DS4_BUTTON_DPAD_NORTHEAST;
        else if (pad.hatY == 1 && pad.hatX == -1) dpad = DS4_BUTTON_DPAD_SOUTHWEST;
        else if (pad.hatY == 1 && pad.hatX == 1) dpad = DS4_BUTTON_DPAD_SOUTHEAST;
        else if (pad.hatY == -1) dpad = DS4_BUTTON_DPAD_NORTH;
        else if (pad.hatY == 1)  dpad = DS4_BUTTON_DPAD_SOUTH;
        else if (pad.hatX == -1) dpad = DS4_BUTTON_DPAD_WEST;
        else if (pad.hatX == 1)  dpad = DS4_BUTTON_DPAD_EAST;
        
        pad.ds4Report.wButtons &= ~0xF; // Clear bottom 4 bits
        pad.ds4Report.wButtons |= dpad;
        
        vigem_target_ds4_update(client, pad.target, pad.ds4Report);
    }
}

Napi::Value SetupVirtualGamepad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int type = info[0].As<Napi::Number>().Int32Value();

    if (!client) {
        client = vigem_alloc();
        if (!client) return Napi::Number::New(env, -1);
        if (!VIGEM_SUCCESS(vigem_connect(client))) {
            vigem_free(client);
            client = nullptr;
            return Napi::Number::New(env, -1);
        }
    }

    VirtualPad pad;
    pad.type = type;
    pad.hatX = 0; pad.hatY = 0;
    
    memset(&pad.xboxReport, 0, sizeof(XUSB_REPORT));
    memset(&pad.ds4Report, 0, sizeof(DS4_REPORT));
    
    // DS4 sticks rest at 128 (center). Xbox sticks rest at 0.
    if (type == 1) { 
        pad.ds4Report.bThumbLX = 128; pad.ds4Report.bThumbLY = 128;
        pad.ds4Report.bThumbRX = 128; pad.ds4Report.bThumbRY = 128;
        pad.ds4Report.wButtons = DS4_BUTTON_DPAD_NONE;
        pad.target = vigem_target_ds4_alloc();
    } else {
        pad.target = vigem_target_x360_alloc();
    }

    if (!VIGEM_SUCCESS(vigem_target_add(client, pad.target))) {
        vigem_target_free(pad.target);
        return Napi::Number::New(env, -1);
    }

    int current_id = next_pad_id++;
    active_pads[current_id] = pad;
    
    return Napi::Number::New(env, current_id);
}

Napi::Value EmitEvent(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int id = info[0].As<Napi::Number>().Int32Value();
    
    if (active_pads.find(id) == active_pads.end()) return Napi::Boolean::New(env, false);
    VirtualPad& pad = active_pads[id];

    int ev_type = info[1].As<Napi::Number>().Int32Value();
    int ev_code = info[2].As<Napi::Number>().Int32Value();
    int ev_value = info[3].As<Napi::Number>().Int32Value();

    if (ev_type == EV_SYN) {
        SyncReport(pad);
    } else if (ev_type == EV_KEY) {
        UpdateButtons(pad, ev_code, ev_value);
    } else if (ev_type == EV_ABS) {
        UpdateAxes(pad, ev_code, ev_value);
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value DestroyVirtualGamepad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int id = info[0].As<Napi::Number>().Int32Value();

    if (active_pads.find(id) != active_pads.end()) {
        vigem_target_remove(client, active_pads[id].target);
        vigem_target_free(active_pads[id].target);
        active_pads.erase(id);
        
        if (active_pads.empty() && client) {
            vigem_disconnect(client);
            vigem_free(client);
            client = nullptr;
        }
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value CheckPermissions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!client) {
        PVIGEM_CLIENT test_client = vigem_alloc();
        if (test_client) {
            if (VIGEM_SUCCESS(vigem_connect(test_client))) {
                vigem_disconnect(test_client);
                vigem_free(test_client);
                return Napi::Boolean::New(env, true);
            }
            vigem_free(test_client);
        }
        return Napi::Boolean::New(env, false);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "setup"), Napi::Function::New(env, SetupVirtualGamepad));
    exports.Set(Napi::String::New(env, "emit"), Napi::Function::New(env, EmitEvent));
    exports.Set(Napi::String::New(env, "destroy"), Napi::Function::New(env, DestroyVirtualGamepad));
    exports.Set(Napi::String::New(env, "checkPermissions"), Napi::Function::New(env, CheckPermissions));
    return exports;
}

NODE_API_MODULE(uinput_gamepad, Init)