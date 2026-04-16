#include <napi.h>

// UInput Gamepad Namespace
namespace GamepadBridge {
    Napi::Value SetupVirtualGamepad(const Napi::CallbackInfo& info);
    Napi::Value EmitEvent(const Napi::CallbackInfo& info);
    Napi::Value DestroyVirtualGamepad(const Napi::CallbackInfo& info);
    Napi::Value CheckPermissions(const Napi::CallbackInfo& info);
}

/**
 * Initializes the Native Node Addon, mapping JavaScript function names to their C++ implementations.
 *
 * @param {Napi::Env} env - The Node.js environment.
 * @param {Napi::Object} exports - The exports object.
 * @returns {Napi::Object} The populated exports object.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Gamepad Methods
    exports.Set(Napi::String::New(env, "setupVg"), Napi::Function::New(env, GamepadBridge::SetupVirtualGamepad));
    exports.Set(Napi::String::New(env, "emitVg"), Napi::Function::New(env, GamepadBridge::EmitEvent));
    exports.Set(Napi::String::New(env, "destroyVg"), Napi::Function::New(env, GamepadBridge::DestroyVirtualGamepad));
    exports.Set(Napi::String::New(env, "checkPermissionsVg"), Napi::Function::New(env, GamepadBridge::CheckPermissions));

    return exports;
}

NODE_API_MODULE(tiny_pony_clipper, Init)