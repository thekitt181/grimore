declare const _default: {
    content: string[];
    theme: {
        extend: {
            colors: {
                bg: {
                    primary: string;
                    secondary: string;
                    tertiary: string;
                };
                accent: {
                    gold: string;
                    red: string;
                    'red-hot': string;
                };
                text: {
                    primary: string;
                    secondary: string;
                };
                border: {
                    DEFAULT: string;
                    gold: string;
                };
            };
            fontFamily: {
                display: [string, string];
                body: [string, string];
                ui: [string, string];
            };
            backgroundImage: {
                'parchment-texture': string;
            };
            boxShadow: {
                gold: string;
                red: string;
                panel: string;
            };
            animation: {
                'torch-flicker': string;
                'fade-in': string;
                'slide-up': string;
                'pulse-gold': string;
            };
            keyframes: {
                torchFlicker: {
                    '0%, 100%': {
                        opacity: string;
                        filter: string;
                    };
                    '50%': {
                        opacity: string;
                        filter: string;
                    };
                };
                fadeIn: {
                    from: {
                        opacity: string;
                    };
                    to: {
                        opacity: string;
                    };
                };
                slideUp: {
                    from: {
                        opacity: string;
                        transform: string;
                    };
                    to: {
                        opacity: string;
                        transform: string;
                    };
                };
                pulseGold: {
                    '0%, 100%': {
                        boxShadow: string;
                    };
                    '50%': {
                        boxShadow: string;
                    };
                };
            };
        };
    };
    plugins: never[];
};
export default _default;
//# sourceMappingURL=tailwind.config.d.ts.map