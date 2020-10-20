var AudioContext = require('@descript/web-audio-js')
var Tuna = require('tunajs')

class AudioProcessor {

    constructor() {
        console.log('Creating an audio processer')
        // The number of performers for this session
        this.numPerformers = 0;

        // The socket IDs of performers in this session
        this.performers = []
        
        // The list of audio input buffers, 1 for each performer
        this.audioInBuffers = []

        // The complete audio for this session
        this.sessionAudio = []

        // The size of the processing audio block - subject to change
        this.blockSize = 1024

        // The audio context interface to Web Audio API
        this.audioContext = new AudioContext.RawDataAudioContext({sampleRate:44100, blockSize:128, numberOfChannels:1})

        // The audio effect generator (we're not using this... yet...)
        this.tuna = new Tuna(this.audioContext)

        // Some examples of audio effects created using tuna
        /*
        this.chorus = new this.tuna.Chorus({
            rate: 1.5,         //0.01 to 8+
            feedback: 0.2,     //0 to 1+
            delay: 0.0045,     //0 to 1
            bypass: 0          //the value 1 starts the effect as bypassed, 0 or 1
        });

        this.overdrive = new this.tuna.Overdrive({
            outputGain: 0,           //-42 to 0 in dB
            drive: 1,                //0 to 1
            curveAmount: 0.725,      //0 to 1
            algorithmIndex: 0,       //0 to 5, selects one of the drive algorithms
            bypass: 0
        });

        this.filter = new this.tuna.Filter({
            frequency: 800,         //20 to 22050
            Q: 1,                   //0.001 to 100
            gain: 0,                //-40 to 40 (in decibels)
            filterType: "lowpass",  //lowpass, highpass, bandpass, lowshelf, highshelf, peaking, notch, allpass
            bypass: 0
        });

        this.delay = new this.tuna.Delay({
            feedback: 0.45,    //0 to 1+
            delayTime: 100,    //1 to 10000 milliseconds
            wetLevel: 0.5,     //0 to 1+
            dryLevel: 1,       //0 to 1+
            cutoff: 20000,      //cutoff frequency of the built in lowpass-filter. 20 to 22050
            bypass: 0
        });

        this.overdrive.connect(this.audioContext.destination)
        
        this.bitcrusher.connect(this.audioContext.destination)
        this.moog.connect(this.bitcrusher)
        this.chorus.connect(this.moog)

        this.chorus.connect(this.audioContext.destination)
        
        this.delay.connect(this.filter)
        this.filter.connect(this.audioContext.destination)

        */

    }

    // This function adds a new performer to the recording session.
    addPerformer(performerID) {
        // Increase the total number of performers by 1
        this.numPerformers += 1;

        // Add the ID of the performer to the list of performers
        this.performers.push(performerID)

        // Add a new empty array to the audio input buffer
        this.audioInBuffers.push([]);

        console.log('Added ' + performerID + ' to the audio processor performers.  Now there are ' + this.numPerformers + ' performers')
    }

    // This function removes a connected performer from the recording session.
    removePerformer(performerID) {
        // Look up the performer by socket ID
        var performerIndex = this.performers.indexOf(performerID)
        if (performerIndex == -1) {
            throw 'Error: Cannot find a performer with socketID ' + performerID + ' to remove from audio processor'
        }

        // Decrease the total number of performers by 1
        this.numPerformers -= 1;

        // Remove the performer from the list of performers
        this.performers.splice(performerIndex, 1)

        // Remove the audio input buffer for that performer
        this.audioInBuffers.splice(performerIndex, 1)

        console.log('Removed ' + performerID + ' from the audio processor performers.  Now there are ' + this.numPerformers + ' performers')
    }

    // This function takes the socket ID of a performer and recorded audio data,
    // parses the raw data from JSON, and adds the raw audio to the buffer for
    // the performer specified by the socket ID
    buffer(performerID, audioIn) {
        var performerIndex = this.performers.indexOf(performerID)
        if (performerIndex == -1) {
            throw 'Error: buffer() cannot find a performer with socketID ' + performerID
        }

        this.audioInBuffers[performerIndex] = this.audioInBuffers[performerIndex].concat(audioIn);

        return this.process()
    }

    // This function processes all the raw audio data from the input buffers through
    // the audio graph specified by the audio context.  If the buffer does not
    // have enought audio to be processed, return null.  If the audio was processed
    // sucessfully, return the processed amd mixed audio data
    process() {
        // Make sure the input buffer is ready for processing
        if (this.isBufferReadyToProcess() == false) {
            return null
        }

        // The processed audio data to be returned
        var processedAudio = []
        //console.log('Time to process some audio!')

        // Create audio source nodes for each performer's input buffer
        var audioSourceNodes = []
        for (var i = 0; i < this.numPerformers; i++) {
            // Create source buffers and fill them with audio data
            var buffer = this.audioContext.createBuffer(1, this.blockSize, 44100)
            var bufferData = buffer.getChannelData()
            for (var j = 0; j < this.blockSize; j++) {
                bufferData[j] = this.audioInBuffers[i].shift()
            }
            
            // Create audio source nodes from the source buffers
            audioSourceNodes[i] = this.audioContext.createBufferSource()
            audioSourceNodes[i].buffer = buffer

            // Start the audio source node so data can be read from it
            audioSourceNodes[i].start()

            // Connect the source nodes to the context destination node
            // so audio data can be read after it is processed
            // By connecting all the sources to the 1 destination node,
            // the audio data is automatically mixed together
            audioSourceNodes[i].connect(this.audioContext.destination)
        }

        // Make sure the audio context is ready to process the audio
        this.audioContext._impl.resume()

        // Process audio through the audio graph 1 block at a time
        for (var i = 0; i < this.blockSize; i += this.audioContext.blockSize) {
            // Create an empty block for data to be written into
            var blockData = [new Float32Array(this.audioContext.blockSize)]

            // Process 1 block of audio through the audio graph and 
            // save it into blockData
            this.audioContext.process(blockData);

            // Push the processed audio block into the list to be returned
            processedAudio.push.apply(processedAudio, blockData[0])
        }
        // Push the processed audio onto the list of audio for the entire session
        this.sessionAudio.push.apply(this.sessionAudio, processedAudio)
        
        // Finally, return the processed audio to be sent to listeners
        return processedAudio
    }

    // Multiple each sample in the session audio to convert to 16-bit int
    // so the data can be encoded as a .wav file
    exportSessionAudio() {
        for (var i = 0; i < this.sessionAudio.length; i++) {
            this.sessionAudio[i] = this.sessionAudio[i] * 32767
        }
        return this.sessionAudio
    }


    // This function will only return true if we have at least blockSize amount of
    // audio data in the input buffer for each performer
    isBufferReadyToProcess() {
        // Find the smallest performer buffer
        var min = this.audioInBuffers[0].length;
        for (var i = 1; i < this.numPerformers; i++) {
            if (this.audioInBuffers[i].length < min) {
                min = this.audioInBuffers[i].length
            }
        }

        if (min < this.blockSize) {
            return false
        } else {
            return true
        }
    }
}

module.exports = AudioProcessor
