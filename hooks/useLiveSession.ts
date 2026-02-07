import { useState, useEffect, useRef, useCallback } from 'react';
import { useMediaStream } from './useMediaStream';
import { generateMultimodalResponse, transcribeAudio } from '../services/geminiService';
import { Message, Role } from '../types';

declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

export type LiveStatus = 'idle' | 'listening' | 'recording' | 'processing' | 'speaking';

interface UseLiveSessionProps {
    onNewMessage: (msg: Message) => void;
    chatHistory: Message[];
}

export const useLiveSession = ({ onNewMessage, chatHistory }: UseLiveSessionProps) => {
    const {
        screenStream, audioStream,
        startScreenShare, stopScreenShare,
        startAudio, stopAudio, error: mediaError
    } = useMediaStream();

    const [status, setStatus] = useState<LiveStatus>('idle');
    const [transcript, setTranscript] = useState('');
    const [isFallbackMode, setIsFallbackMode] = useState(false);

    // Refs
    const recognitionRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const statusRef = useRef<LiveStatus>('idle');
    const silenceTimer = useRef<NodeJS.Timeout | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    // Keep status ref in sync
    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    // Cleanup helper
    const cleanupAudioAnalysis = useCallback(() => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
    }, []);

    // Manual VAD (Fallback) implementation
    const startAudioAnalysisVAD = useCallback((stream: MediaStream) => {
        if (audioContextRef.current) return; // Already running

        console.log("Fallback VAD: Starting Analysis...");
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        let silenceStart = Date.now();
        let isSpeaking = false;

        const checkVolume = () => {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;

            // Log volume every ~1s (60 frames) to reduce noise but verify activity
            if (Date.now() % 1000 < 50) {
                console.log("VAD Volume:", average);
            }

            // Significantly lower threshold
            const threshold = 5;

            if (average > threshold) {
                if (!isSpeaking) {
                    console.log("Fallback VAD: Speech detected (Vol: " + average.toFixed(2) + ")");
                    isSpeaking = true;
                    if (statusRef.current === 'listening') {
                        startRecording();
                    }
                }
                silenceStart = Date.now(); // Reset silence
            } else {
                if (isSpeaking && (Date.now() - silenceStart > 1500)) {
                    // Silence for 1.5s
                    console.log("Fallback VAD: Silence detected");
                    isSpeaking = false;
                    commitTurnRef.current();
                }
            }

            animationFrameRef.current = requestAnimationFrame(checkVolume);
        };

        checkVolume();
    }, []);

    // Initialize Speech Recognition
    useEffect(() => {
        // Native Speech Recognition Setup
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onstart = () => {
                console.log("VAD: Speech Recognition Started");
            };

            recognition.onresult = (event: any) => {
                if (statusRef.current !== 'listening' && statusRef.current !== 'recording') return;

                const currentFullTranscript = Array.from(event.results)
                    .map((result: any) => result[0].transcript)
                    .join('');

                setTranscript(currentFullTranscript);

                if (statusRef.current === 'listening' && currentFullTranscript.trim().length > 0) {
                    startRecording();
                }
                if (statusRef.current === 'recording') {
                    resetSilenceTimer();
                }
            };

            recognition.onend = () => {
                console.log("VAD: Speech Recognition Stopped");
                // Auto-restart if needed and not in fallback
                if (!isFallbackMode && (statusRef.current === 'listening' || statusRef.current === 'recording')) {
                    setTimeout(() => {
                        if (!isFallbackMode && (statusRef.current === 'listening' || statusRef.current === 'recording')) {
                            try { recognition.start(); } catch (e) { }
                        }
                    }, 100);
                }
            };

            recognition.onerror = (event: any) => {
                console.error("Speech Recognition Error", event.error);
                if (event.error === 'network' || event.error === 'service-not-allowed' || event.error === 'aborted') {
                    // Switch to Fallback
                    if (!isFallbackMode) {
                        console.warn("Switching to Fallback Mode (Gemini Audio VAD)");
                        setIsFallbackMode(true);
                        recognition.abort();
                    }
                }
            };

            recognitionRef.current = recognition;
        } else {
            setIsFallbackMode(true);
        }

        return () => {
            if (recognitionRef.current) recognitionRef.current.abort();
            cleanupAudioAnalysis();
        };
    }, []); // Mount only

    // Watch for Fallback Mode + Audio Stream to start manual VAD
    useEffect(() => {
        if (isFallbackMode && audioStream && status === 'listening') {
            startAudioAnalysisVAD(audioStream);
        }
    }, [isFallbackMode, audioStream, status]);

    const resetSilenceTimer = useCallback(() => {
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        silenceTimer.current = setTimeout(() => {
            console.log("VAD: Silence detected (Native), committing...");
            commitTurnRef.current();
        }, 2000);
    }, []);

    const startRecording = useCallback(() => {
        if (statusRef.current === 'recording') return;

        setStatus('recording');
        chunksRef.current = [];

        // Update: Record Video + Audio so we capture screen context + user voice
        let streamToRecord = screenStream;

        if (screenStream && audioStream) {
            const tracks = [...screenStream.getTracks(), ...audioStream.getAudioTracks()];
            streamToRecord = new MediaStream(tracks);
        } else if (audioStream && isFallbackMode) {
            streamToRecord = audioStream;
        }

        if (streamToRecord) {
            try {
                const recorder = new MediaRecorder(streamToRecord, { mimeType: 'video/webm; codecs=vp9' });
                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunksRef.current.push(e.data);
                };
                mediaRecorderRef.current = recorder;
                recorder.start();
            } catch (e) {
                console.error("Failed to create MediaRecorder:", e);
                try {
                    const recorder = new MediaRecorder(streamToRecord); // Default
                    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
                    mediaRecorderRef.current = recorder;
                    recorder.start();
                } catch (e2) {
                    console.error("Failed backup recorder", e2);
                }
            }
        }

        if (!isFallbackMode) {
            resetSilenceTimer();
        }
    }, [screenStream, audioStream, isFallbackMode, resetSilenceTimer]);

    const transcriptRef = useRef('');
    useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

    const handleTurnComplete = async () => {
        console.log("Commit Turn Triggered");

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }

        if (recognitionRef.current && !isFallbackMode) {
            try { recognitionRef.current.stop(); } catch (e) { }
        }

        setStatus('processing');
        if (silenceTimer.current) clearTimeout(silenceTimer.current);

        await new Promise(r => setTimeout(r, 500)); // Wait for chunks

        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        let currentText = transcriptRef.current;

        // If Fallback, we need to Transcribe NOW
        if (isFallbackMode) {
            console.log("Fallback: Transcribing audio...");
            try {
                // Optimize: Transcribe first to get text for UI logic
                const transcription = await transcribeAudio(blob);
                currentText = transcription;
                setTranscript(transcription);
            } catch (e) {
                console.error("Fallback Transcription Failed", e);
                currentText = "";
            }
        }

        console.log("Submitting to Gemini:", currentText);
        const prompt = currentText || "Describe what is happening.";
        setTranscript('');

        try {
            const responseText = await generateMultimodalResponse(
                prompt,
                chatHistory,
                blob,
                'video/webm'
            );

            const newMsg: Message = {
                id: crypto.randomUUID(),
                role: Role.MODEL,
                text: responseText,
                timestamp: Date.now()
            };
            onNewMessage(newMsg);
            speakResponse(responseText);

        } catch (e) {
            console.error("Gemini Error:", e);
            setStatus('listening');
            if (!isFallbackMode && recognitionRef.current) {
                try { recognitionRef.current.start(); } catch (e) { }
            }
        }
    };

    const commitTurnRef = useRef(handleTurnComplete);
    useEffect(() => { commitTurnRef.current = handleTurnComplete; }, [chatHistory, onNewMessage, isFallbackMode]);

    const speakResponse = (text: string) => {
        setStatus('speaking');
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => {
            console.log("TTS Finished, resuming listening...");
            setStatus('listening');
            if (!isFallbackMode && recognitionRef.current) {
                try { recognitionRef.current.start(); } catch (e) { }
            }
        };
        window.speechSynthesis.speak(utterance);
    };

    const startSession = async () => {
        try {
            await startScreenShare();
            await startAudio();

            setStatus('listening');
            if (!isFallbackMode && recognitionRef.current) {
                try { recognitionRef.current.start(); } catch (e) { }
            }
        } catch (err) {
            console.error("Failed to start session:", err);
            // Handle error state
        }
    };

    const stopSession = () => {
        stopScreenShare();
        stopAudio();
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch (e) { }
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        cleanupAudioAnalysis();
        setStatus('idle');
        setTranscript('');
        window.speechSynthesis.cancel();
    };

    return {
        status,
        transcript,
        startSession,
        stopSession,
        videoStream: screenStream,
        error: mediaError
    };
};
