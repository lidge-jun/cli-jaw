import { connectJawCeoVoice } from './api';

export type JawCeoVoicePeerSession = {
    sessionId: string;
    peer: RTCPeerConnection;
    dataChannel: RTCDataChannel;
    micStream: MediaStream;
    audio: HTMLAudioElement;
    setMicEnabled: (enabled: boolean) => void;
    close: () => void;
};

export async function createJawCeoVoicePeerSession(args: {
    sessionId?: string;
    selectedPort: number | null;
    onRealtimeEvent: (event: unknown) => void;
}): Promise<JawCeoVoicePeerSession> {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is not available in this browser.');
    }
    const peer = new RTCPeerConnection();
    const dataChannel = peer.createDataChannel('oai-events');
    dataChannel.onmessage = event => {
        try {
            args.onRealtimeEvent(JSON.parse(event.data as string));
        } catch {
            args.onRealtimeEvent({ type: 'raw', text: String(event.data) });
        }
    };

    const remoteStream = new MediaStream();
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.srcObject = remoteStream;
    audio.className = 'jaw-ceo-voice-audio';
    audio.setAttribute('aria-hidden', 'true');
    document.body.appendChild(audio);

    peer.ontrack = event => {
        for (const track of event.streams[0]?.getTracks() || [event.track]) {
            if (!remoteStream.getTracks().includes(track)) remoteStream.addTrack(track);
        }
    };

    const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
        },
    });
    for (const track of micStream.getTracks()) peer.addTrack(track, micStream);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (!offer.sdp) throw new Error('Browser did not create a voice SDP offer.');

    const connected = await connectJawCeoVoice({
        offerSdp: offer.sdp,
        selectedPort: args.selectedPort,
        ...(args.sessionId ? { sessionId: args.sessionId } : {}),
        responseMode: 'voice',
    });
    await peer.setRemoteDescription({ type: 'answer', sdp: connected.answerSdp });

    function close(): void {
        dataChannel.close();
        for (const track of micStream.getTracks()) track.stop();
        peer.close();
        audio.remove();
    }

    function setMicEnabled(enabled: boolean): void {
        for (const track of micStream.getAudioTracks()) track.enabled = enabled;
    }

    return {
        sessionId: connected.sessionId,
        peer,
        dataChannel,
        micStream,
        audio,
        setMicEnabled,
        close,
    };
}
