/**
 * @typedef {import("../../../entities/core/ValetudoVirtualRestrictions")} ValetudoVirtualRestrictions
 */

const fs = require("fs");
const path = require("path");

const CombinedVirtualRestrictionsCapability = require("../../../core/capabilities/CombinedVirtualRestrictionsCapability");
const Logger = require("../../../Logger");
const ValetudoRestrictedZone = require("../../../entities/core/ValetudoRestrictedZone");
const {Pixel} = require("@agnoc/core");

/**
 * @extends CombinedVirtualRestrictionsCapability<import("../CecotecCongaRobot")>
 */
class CecotecCombinedVirtualRestrictionsCapability extends CombinedVirtualRestrictionsCapability {
    /**
     * @param {object} options
     * @param {import("../CecotecCongaRobot")} options.robot
     */
    constructor(options) {
        super(Object.assign({}, options, {
            supportedRestrictedZoneTypes: [
                ValetudoRestrictedZone.TYPE.REGULAR,
                ValetudoRestrictedZone.TYPE.MOP
            ]
        }));

        this.profileDirectory = path.join(path.dirname(this.robot.config.location), "restricciones");
        this.profilePaths = {
            [CecotecCombinedVirtualRestrictionsCapability.PROFILE.REGULAR]: path.join(this.profileDirectory, "regular.json"),
            [CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP]: path.join(this.profileDirectory, "mop.json")
        };
    }

    /**
     * @returns {Promise<import("../../../entities/core/ValetudoVirtualRestrictions")>}
     */
    async getVirtualRestrictions() {
        if (this.hasProfile(CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP)) {
            const profile = this.loadProfile(CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP);

            if (profile) {
                return profile;
            }

            Logger.warn("Falling back to the robot map because the Cecotec mop virtual restriction profile could not be loaded");
        }

        return super.getVirtualRestrictions();
    }

    /**
     * @param {ValetudoVirtualRestrictions} virtualRestrictions
     * @returns {Promise<void>}
     */
    async setVirtualRestrictions(virtualRestrictions) {
        const robot = this.robot.robot;

        if (!robot) {
            throw new Error("There is no robot connected to server");
        }

        this.saveProfiles(virtualRestrictions);

        await this.applyCurrentProfile(robot);
    }

    /**
     * @param {import("@agnoc/core").Robot} [robot]
     * @returns {Promise<boolean>}
     */
    async applyCurrentProfile(robot = this.robot.robot) {

        if (!robot) {
            throw new Error("There is no robot connected to server");
        }

        if (!this.hasAnyProfile()) {
            Logger.info("No Cecotec virtual restriction profiles available; preserving current robot restrictions");

            return false;
        }

        const selectedProfile = this.getProfileNameForMopState(robot.device?.hasMopAttached);
        const safeProfile = this.loadSafestAvailableProfile(selectedProfile);

        if (!safeProfile) {
            Logger.warn("Skipping Cecotec virtual restriction profile application because no safe profile is available");

            return false;
        }

        await this.applyVirtualRestrictionsToRobot(robot, safeProfile.virtualRestrictions);

        Logger.info("Applied Cecotec virtual restriction profile:", safeProfile.profileName);

        return true;
    }

    /**
     * @param {ValetudoVirtualRestrictions} virtualRestrictions
     */
    saveProfiles(virtualRestrictions) {
        const mopProfile = this.toPlainVirtualRestrictions(virtualRestrictions);
        const regularProfile = this.deriveRegularProfile(mopProfile);

        fs.mkdirSync(this.profileDirectory, {recursive: true});

        fs.writeFileSync(
            this.profilePaths[CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP],
            JSON.stringify(mopProfile, null, 2)
        );
        Logger.info("Saved Cecotec mop virtual restriction profile:", this.profilePaths[CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP]);

        fs.writeFileSync(
            this.profilePaths[CecotecCombinedVirtualRestrictionsCapability.PROFILE.REGULAR],
            JSON.stringify(regularProfile, null, 2)
        );
        Logger.info("Saved derived Cecotec regular virtual restriction profile:", this.profilePaths[CecotecCombinedVirtualRestrictionsCapability.PROFILE.REGULAR]);
    }

    /**
     * @param {object} virtualRestrictions
     * @returns {object}
     */
    deriveRegularProfile(virtualRestrictions) {
        return Object.assign({}, virtualRestrictions, {
            virtualWalls: virtualRestrictions.virtualWalls,
            restrictedZones: virtualRestrictions.restrictedZones.filter(restrictedZone => {
                return restrictedZone.type !== ValetudoRestrictedZone.TYPE.MOP;
            })
        });
    }

    /**
     * @param {ValetudoVirtualRestrictions} virtualRestrictions
     * @returns {object}
     */
    toPlainVirtualRestrictions(virtualRestrictions) {
        return JSON.parse(JSON.stringify(virtualRestrictions));
    }

    /**
     * @param {boolean | undefined} hasMopAttached
     * @returns {string}
     */
    getProfileNameForMopState(hasMopAttached) {
        if (hasMopAttached === true) {
            return CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP;
        }

        if (hasMopAttached === false) {
            return CecotecCombinedVirtualRestrictionsCapability.PROFILE.REGULAR;
        }

        Logger.warn("Mop attachment state is unknown; selecting the mop virtual restriction profile to avoid a less restrictive profile");

        return CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP;
    }

    /**
     * @returns {boolean}
     */
    hasAnyProfile() {
        return Object.keys(this.profilePaths).some(profile => {
            return this.hasProfile(profile);
        });
    }

    /**
     * @param {string} profile
     * @returns {boolean}
     */
    hasProfile(profile) {
        const profilePath = this.profilePaths[profile];

        try {
            return fs.existsSync(profilePath) && fs.statSync(profilePath).isFile();
        } catch (e) {
            Logger.warn(`Unable to check Cecotec virtual restriction ${profile} profile`, e);

            return false;
        }
    }

    /**
     * @param {string} selectedProfile
     * @returns {{profileName: string, virtualRestrictions: import("../../../entities/core/ValetudoVirtualRestrictions")} | undefined}
     */
    loadSafestAvailableProfile(selectedProfile) {
        const profile = this.loadProfile(selectedProfile);

        if (profile) {
            return {
                profileName: selectedProfile,
                virtualRestrictions: profile
            };
        }

        if (selectedProfile === CecotecCombinedVirtualRestrictionsCapability.PROFILE.REGULAR) {
            Logger.warn("Regular virtual restriction profile is unavailable; trying mop profile as the safer fallback");

            const fallbackProfile = this.loadProfile(CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP);

            if (fallbackProfile) {
                return {
                    profileName: CecotecCombinedVirtualRestrictionsCapability.PROFILE.MOP,
                    virtualRestrictions: fallbackProfile
                };
            }
        }

        return undefined;
    }

    /**
     * @param {string} profile
     * @returns {ValetudoVirtualRestrictions | undefined}
     */
    loadProfile(profile) {
        const profilePath = this.profilePaths[profile];

        try {
            const rawProfile = JSON.parse(fs.readFileSync(profilePath, {encoding: "utf-8"}));

            if (!Array.isArray(rawProfile?.virtualWalls) || !Array.isArray(rawProfile?.restrictedZones)) {
                throw new Error("Invalid Cecotec virtual restriction profile shape");
            }

            Logger.info(`Loaded Cecotec virtual restriction ${profile} profile:`, profilePath);

            return rawProfile;
        } catch (e) {
            if (e.code === "ENOENT") {
                Logger.info(`Cecotec virtual restriction ${profile} profile is unavailable; skipping:`, profilePath);
            } else {
                Logger.warn(`Unable to load Cecotec virtual restriction ${profile} profile`, e);
            }

            return undefined;
        }
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     * @param {ValetudoVirtualRestrictions} virtualRestrictions
     * @returns {Promise<void>}
     */
    async applyVirtualRestrictionsToRobot(robot, { virtualWalls, restrictedZones }) {
        const map = robot.device.map;

        if (!map) {
            Logger.warn("Skipping Cecotec virtual restriction profile application because the robot map is unavailable");

            return;
        }

        const offset = map.size.y;
        const areas = [
            ...virtualWalls.map(({ points }) => {
                return [
                    map.toCoordinate(new Pixel({
                        x: points.pA.x,
                        y: offset - points.pA.y,
                    })),
                    map.toCoordinate(new Pixel({
                        x: points.pB.x,
                        y: offset - points.pB.y,
                    })),
                    map.toCoordinate(new Pixel({
                        x: points.pA.x,
                        y: offset - points.pA.y,
                    })),
                    map.toCoordinate(new Pixel({
                        x: points.pB.x,
                        y: offset - points.pB.y,
                    })),
                ];
            }),
            ...restrictedZones.map(({ points }) => {
                return [
                    map.toCoordinate(new Pixel({
                        x: points.pA.x,
                        y: offset - points.pA.y,
                    })),
                    map.toCoordinate(new Pixel({
                        x: points.pD.x,
                        y: offset - points.pD.y,
                    })),
                    map.toCoordinate(new Pixel({
                        x: points.pC.x,
                        y: offset - points.pC.y,
                    })),
                    map.toCoordinate(new Pixel({
                        x: points.pB.x,
                        y: offset - points.pB.y,
                    })),
                ];
            })
        ];

        await robot.setRestrictedZones(areas);
        await robot.updateMap();
    }
}

CecotecCombinedVirtualRestrictionsCapability.PROFILE = Object.freeze({
    REGULAR: "regular",
    MOP: "mop"
});

module.exports = CecotecCombinedVirtualRestrictionsCapability;
