export function getAbilityModifier(score) {
    return Math.floor((score - 10) / 2);
}
export function formatModifier(modifier) {
    return modifier >= 0 ? `+${modifier}` : String(modifier);
}
export function getCRDisplay(cr) {
    if (cr === 0.125)
        return '1/8';
    if (cr === 0.25)
        return '1/4';
    if (cr === 0.5)
        return '1/2';
    return String(cr);
}
//# sourceMappingURL=types.js.map