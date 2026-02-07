import { useState, useRef, useCallback, useEffect } from 'react';

interface UseMediaStreamReturn {
    screenStream: MediaStream | null;
    audioStream: MediaStream | null;
    startScreenShare: () => Promise<void>;
    stopScreenShare: () => void;
    startAudio: () => Promise<void>;
    stopAudio: () => void;
    error: string | null;
}

export const useMediaStream = (): UseMediaStreamReturn => {
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
    const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);

    const startScreenShare = useCallback(async () => {
        try {
            setError(null);
            // Request screen share WITH system audio if possible
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            setScreenStream(stream);

            // Handle stream end (user clicks "Stop sharing" in browser UI)
            stream.getVideoTracks()[0].onended = () => {
                setScreenStream(null);
            };

        } catch (err: any) {
            console.error("Error starting screen share:", err);
            setError("Failed to start screen share. Please allow permissions.");
        }
    }, []);

    const stopScreenShare = useCallback(() => {
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            setScreenStream(null);
        }
    }, [screenStream]);

    const startAudio = useCallback(async () => {
        try {
            setError(null);
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            setAudioStream(stream);
        } catch (err: any) {
            console.error("Error starting audio:", err);
            setError("Failed to access microphone.");
        }
    }, []);

    const stopAudio = useCallback(() => {
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
            setAudioStream(null);
        }
    }, [audioStream]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (screenStream) screenStream.getTracks().forEach(t => t.stop());
            if (audioStream) audioStream.getTracks().forEach(t => t.stop());
        };
    }, []);

    return {
        screenStream,
        audioStream,
        startScreenShare,
        stopScreenShare,
        startAudio,
        stopAudio,
        error
    };
};
