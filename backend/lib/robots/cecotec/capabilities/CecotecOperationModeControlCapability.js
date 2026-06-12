const OperationModeControlCapability = require("../../../core/capabilities/OperationModeControlCapability");
const { DeviceMode } = require("@agnoc/core");
/**
 * @extends OperationModeControlCapability<import("../CecotecCongaRobot")>
 */
module.exports = class CecotecOperationModeControlCapability extends OperationModeControlCapability {
    /**
     * @abstract
     * @param {string} preset
     * @returns {Promise<void>}
     */
    async selectPreset(preset) {
        if (!this.robot.robot) {
            throw new Error("There is no robot connected to server");
        }

        const matchedPreset = this.presets.find(p => {
            return p.name === preset;
        });

        if (!matchedPreset) {
            throw new Error("Invalid Preset");
        }

        await this.robot.robot.setMode(new DeviceMode({ value: matchedPreset.value }));
    }
}
