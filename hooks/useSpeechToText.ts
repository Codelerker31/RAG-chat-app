import { useState, useRef, useCallback, useEffect } from 'react';
import { transcribeAudio } from '../services/geminiService';

export type SpeechStatus = 'idle' | 'listening' | 'recording' | 'processing' | 'error';

interface UseSpeechToTextProps {
    onTranscript: (text: string) => void;
    onError?: (error: string) => void;
}

export const useSpeechToText = ({ onTranscript, onError }: UseSpeechToTextProps) => {
    const [status, setStatus] = useState<SpeechStatus>('idle');
    const [isFallbackMode, setIsFallbackMode] = useState(false);

    // Refs
    const recognitionRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const startListening = useCallback(() => {
        // RESET
        setStatus('listening');

        // Strategy A: Browser Speech Recognition (Input Mode)
        // If we already know fallback is needed, skip to Strategy B
        if (!isFallbackMode && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
            try {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                const recognition = new SpeechRecognition();
                recognition.continuous = false;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onstart = () => {
                    console.log("STT: Native Service Started");
                    setStatus('listening');
                };

                recognition.onresult = (event: any) => {
                    const current = event.results[event.results.length - 1][0].transcript;
                    // For input mode, we might want interim results if provided, 
                    // but let's stick to final or updating the input live.
                    // The 'onTranscript' prop can assume partial updates if we want.
                    // For now, let's just pass what we have.
                    onTranscript(current);
                };

                recognition.onerror = (event: any) => {
                    console.warn("STT: Native Error", event.error);
                    if (event.error === 'network' || event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                        // Switch to Fallback
                        console.log("STT: Switching to Fallback Mode (Gemini Audio)");
                        setIsFallbackMode(true);
                        recognition.stop();
                        // Auto-start fallback? 
                        // It's safer to ask user to click again or auto-switch?
                        // Let's try to auto-recover immediately.
                        startFallbackRecording();
                    } else {
                        setStatus('error');
                        if (onError) onError(event.error);
                    }
                };

                recognition.onend = () => {
                    if (status === 'listening') {
                        setStatus('idle');
                    }
                };

                recognitionRef.current = recognition;
                recognition.start();
                return;
            } catch (e) {
                console.error("STT: Native init failed", e);
                setIsFallbackMode(true);
                // proceed to fallback
            }
        } else {
            // Fallback immediately if flag set or API missing
            startFallbackRecording();
        }

    }, [isFallbackMode, onTranscript, status, onError]);

    const startFallbackRecording = () => {
        setStatus('recording'); // Distinct status so UI knows it's using mic audio recording
        chunksRef.current = [];

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                const recorder = new MediaRecorder(stream);

                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunksRef.current.push(e.data);
                };

                recorder.onstop = async () => {
                    setStatus('processing');
                    // Stop all tracks
                    stream.getTracks().forEach(t => t.stop());

                    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                    try {
                        const text = await transcribeAudio(blob);
                        if (text) onTranscript(text);
                        setStatus('idle');
                    } catch (e) {
                        console.error("STT: Fallback failed", e);
                        setStatus('error');
                        if (onError) onError("Transcription failed");
                    }
                };

                mediaRecorderRef.current = recorder;
                recorder.start();
            })
            .catch(err => {
                console.error("STT: Mic permission failed", err);
                setStatus('error');
                if (onError) onError("Microphone access denied");
            });
    };

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch (e) { }
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop(); // This triggers onstop -> transcription
        } else {
            setStatus('idle');
        }
    }, []);

    // Cleanup
    useEffect(() => {
        return () => {
            if (recognitionRef.current) try { recognitionRef.current.abort(); } catch (e) { }
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
        };
    }, []);

    return {
        status,
        isFallbackMode,
        startListening,
        stopListening
    };
};
