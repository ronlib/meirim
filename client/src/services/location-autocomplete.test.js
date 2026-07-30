describe('location-autocomplete service', () => {
    let originalConfig;
    let originalGoogle;

    beforeEach(() => {
        jest.resetModules();
        document.querySelectorAll('script').forEach((s) => s.remove());
        originalGoogle = window.google;
        delete window.google;
        window.google = undefined;
        originalConfig = process.env.CONFIG;
        Object.defineProperty(process.env, 'CONFIG', { value: { geocode: { mapsApiKey: 'TEST_KEY' } }, writable: true, configurable: true });
    });

    afterEach(() => {
        document.querySelectorAll('script').forEach((s) => s.remove());
        if (originalGoogle === undefined) {
            delete window.google;
        } else {
            window.google = originalGoogle;
        }
        delete process.env.CONFIG;
        if (originalConfig !== undefined) {
            Object.defineProperty(process.env, 'CONFIG', { value: originalConfig, writable: true, configurable: true });
        }
    });

    it('init() called twice appends only one Google Maps script tag', async () => {
        const service = require('./location-autocomplete');
        window.google = undefined;

        const p1 = service.init();
        const p2 = service.init();

        const scripts = document.querySelectorAll('script[src*="maps.googleapis.com"]');
        expect(scripts.length).toBe(1);

        window.google = { maps: {} };
        scripts[0].dispatchEvent(new window.Event('load'));

        await expect(p1).resolves.toEqual({ maps: {} });
        await expect(p2).resolves.toEqual({ maps: {} });
    });

    it('init() resolves immediately if window.google is already set', async () => {
        const service = require('./location-autocomplete');
        window.google = { maps: {} };

        const p = service.init();

        await expect(p).resolves.toEqual({ maps: {} });
        expect(document.querySelectorAll('script[src*="maps.googleapis.com"]').length).toBe(0);
    });

    it('a simulated load failure resets the cache so init() is retryable', async () => {
        document.querySelectorAll('script').forEach((s) => s.remove());
        delete window.google;
        window.google = undefined;

        const service = require('./location-autocomplete');

        const p1 = service.init();
        const scripts1 = document.querySelectorAll('script[src*="maps.googleapis.com"]');
        expect(scripts1.length).toBe(1);
        scripts1[0].onload();

        await expect(p1).rejects.toEqual('failed to load google library');

        const p2 = service.init();
        expect(p2).not.toBe(p1);

        window.google = { maps: {} };
        scripts1[0].dispatchEvent(new window.Event('load'));

        await expect(p2).resolves.toEqual({ maps: {} });
    });
});