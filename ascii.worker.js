// ascii.worker.js
let wasmModule;
let currentController = null;

// Initialize the WASM module
self.importScripts('ascii_generator.js');

Module.onRuntimeInitialized = () => {
    wasmModule = Module;
    self.postMessage({ type: 'initialized' });
};

self.onmessage = async function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'generate':
            try {
                // Cancel any ongoing operation
                if (currentController) {
                    currentController.abort();
                }
                
                // Create new controller for this operation
                currentController = new AbortController();
                
                // Begin ASCII generation
                await generateASCII(data, currentController.signal);
                
            } catch (error) {
                if (error.name === 'AbortError') {
                    self.postMessage({ 
                        type: 'cancelled',
                        requestId: data.requestId 
                    });
                } else {
                    self.postMessage({ 
                        type: 'error',
                        error: error.message,
                        requestId: data.requestId 
                    });
                }
            } finally {
                currentController = null;
            }
            break;
    }
};

async function generateASCII(data, signal) {
    if (!wasmModule) {
        throw new Error('WASM module not initialized');
    }

    const { imageData, width: outputWidth, useColor, requestId } = data;
    const { width, height, data: pixels } = imageData;
    const channels = 4; // RGBA

    // Check for abort signal
    if (signal.aborted) {
        throw new Error('Operation cancelled');
    }

    // Allocate memory for the image data
    const imagePtr = wasmModule._malloc(width * height * channels);
    
    try {
        // Copy image data to WASM memory
        wasmModule.HEAPU8.set(pixels, imagePtr);

        // Check for abort signal again
        if (signal.aborted) {
            throw new Error('Operation cancelled');
        }

        // Generate ASCII art
        const asciiPtr = wasmModule.ccall(
            'generate_ascii_wasm',
            'number',
            ['number', 'number', 'number', 'number', 'number', 'number'],
            [imagePtr, width, height, channels, outputWidth, useColor ? 1 : 0]
        );

        // Check for abort signal again
        if (signal.aborted) {
            throw new Error('Operation cancelled');
        }

        // Get the result
        const asciiArt = wasmModule.UTF8ToString(asciiPtr);

        // Free the memory
        wasmModule._free(asciiPtr);

        // Send the result back
        self.postMessage({
            type: 'result',
            ascii: asciiArt,
            requestId: requestId
        });

    } finally {
        // Always free the input image memory
        wasmModule._free(imagePtr);
    }
}

// Error handler
self.onerror = function(error) {
    self.postMessage({
        type: 'error',
        error: error.message
    });
};