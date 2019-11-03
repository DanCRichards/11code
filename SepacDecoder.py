#!/usr/bin/python
# -*- coding: utf-8 -*-

# ==============================================
#
#
#                CCIR DECODER
#         Created by Dan Richards 2018
#             Adapted from Py5mon
#
#   www.github.com/DanCRichards/SepacDecoder
#
#
# =============================================

from optparse import OptionParser
import pyaudio
import wave
import numpy
import sys
import os
import stat
stations = dict() 
appliances = dict() 
with open('Store/appliances.txt') as openfileobject:
    for line in openfileobject:
        data = line.split(',')
        appliances[data[0]] = data[1][0:-1]

with open('Store/stations.txt') as openfileobject:
    for line in openfileobject:
        data = line.split(',')
        stations[data[0]] = data[1][0:-1]

# The notifier function
def notify(title, subtitle, message):
    t = '-title {!r}'.format(title)
    s = '-subtitle {!r}'.format(subtitle)
    m = '-message {!r}'.format(message)
    os.system('terminal-notifier {}'.format(' '.join([m, t, s])))

# Calling the function
parser = OptionParser(usage='%prog [-d] [-i] [-p] FILE')
parser.add_option(
    '-d',
    '--debug',
    default=False,
    action='store_true',
    dest='debug',
    help='Enable debugging',
    )
parser.add_option(
    '-p',
    '--play',
    default=False,
    action='store_true',
    dest='play',
    help='Play the file out loud',
    )
parser.add_option(
    '-i',
    '--input',
    default=False,
    action='store_true',
    dest='input',
    help='Use line-in/mic as input instead of FILE. Do not specify FILE or -p with this.'
        ,
    )

(options, args) = parser.parse_args()

# lenght of file to inspect each run

frames = 1024

# play out loud?

if options.play:
    play = True
else:
    play = False

# debug?

if options.debug:
    debug = True
else:
    debug = False

# use mic/line-in?

if options.input:
    ainput = True
else:
    ainput = False

# filename comes as a positional argument:

if not ainput:
    try:
        if args[0]:
            wavfile = args[0]
    except:
        parser.print_help()
        sys.exit(1)
    if not os.path.isfile(wavfile) \
        and not stat.S_ISFIFO(os.stat(wavfile).st_mode):
        print('test')
        parser.print_help()
        sys.exit(1)

if play:
    pa = pyaudio.PyAudio()

if not ainput:
    wav = wave.open(wavfile, 'rb')
    sw = wav.getsampwidth()
    rate = wav.getframerate()
else:
    pi = pyaudio.PyAudio()
    streaminput = pi.open(format=pyaudio.paInt16, rate=44100,
                          channels=1, input=True,
                          frames_per_buffer=frames)
    sw = pi.get_sample_size(pyaudio.paInt16)
    rate = 44100

window = numpy.blackman(frames)
train = []
tonenone = 0

reffreq = {}
reffreq['1'] = 1124
reffreq['2'] = 1197
reffreq['3'] = 1275
reffreq['4'] = 1358
reffreq['5'] = 1446
reffreq['6'] = 1540
reffreq['7'] = 1640
reffreq['8'] = 1747
reffreq['9'] = 1860
reffreq['0'] = 1981
reffreq['a'] = 2400
reffreq['b'] = 930
reffreq['c'] = 2247
reffreq['d'] = 991
reffreq['e'] = 2110
reffreq['f'] = 1055


# need to remove decimals

def numdec(x):
    if x != x:
        x = 10
    return int('{0:g}'.format(x))


# look for right frequencies...

def checkfreq(freq, reffreq):
    for (rtone, rfreq) in reffreq.items():
        if rfreq - 14 <= freq and rfreq + 14 >= freq:
            return rtone


# clean the train

def cleantrain(train):
    lasttone = None
    newtrain = []

    for tone in train:
        if not tone == lasttone:
            newtrain.append(tone)
        lasttone = tone

    if len(newtrain) == 11:   # FOR APPLIANCE K CODE
        atrain = newtrain[:6]
        btrain = newtrain[6:]
        printtrain(atrain)
        printtrain(btrain)
    elif len(newtrain) == 6:  #FOR STATION TONES / FCOM ACK
        printtrain(newtrain)


def printtrain(newtrain):
    lasttone = None
    train = ''
    for tone in newtrain:
        if tone == 'e' and lasttone:
            tone = lasttone
        lasttone = tone
        train = train + tone
    if len(train) == 6:
        #For Station Tone / FCom ACK 
        if train[0] == 'd' or train[0] == 'c':
            # Appliance
            if train[0:5] not in appliances:
                appliances[train[0:5]] = "UNKNOWN " + str(train[0:5])
                f = open("Store/appliances.txt", "a")
                f.write(train[0:5] + ",Unknown Appliance\n")
                f.close()
            sys.stdout.write("Appliance: " + str(appliances[train[0:5]]))
        if train[0] == '1':
            #Station Tone
            if train[0:5] not in stations:
                stations[train[0:5]] = "UNKNOWN STATION " + str(train)
                f = open("Store/stations.txt", "a")
                f.write(train[0:5] + ", Unknown Station\n")
                f.close()
            sys.stdout.write( str(stations[train]) + " Fire Station Turnout")
            notify(title    = str(stations[train]) + " turnout",
                   subtitle = 'FENZ SelCall Decoder',
                   message  = 'Turnout Tone')
    else:
        kCode = int(train[1])
        if kCode == 1:
            sys.stdout.write("K1 - Responding")
        elif kCode == 2:
            sys.stdout.write("K2 - At Incident")
        elif kCode == 3:
            sys.stdout.write("K3 - Out of Area(" + str("".join(newtrain[2:4]))+")")
        elif kCode == 4:
            sys.stdout.write("K4 - On RT In Area")
        elif kCode == 7:
            sys.stdout.write("K7 - On Station")
        elif kCode == 9:
            if int(train[2]) == 9:
                sys.stdout.write("K99 - Fire Well Involved on Arrival")
            else:
                sys.stdout.write("K9 - On Station(" + str("".join(newtrain[2:4]))+")")
    sys.stdout.write('\n')
    sys.stdout.write(train)


# this is to actually play the file

if play:
    stream = pa.open(format=pa.get_format_from_width(sw),
                     channels=wav.getnchannels(), rate=rate,
                     output=True, output_device_index=None)

if ainput:
    data = streaminput.read(frames)
else:
    data = wav.readframes(frames)

while len(data) == frames * sw:
    if play:
        stream.write(data)

    indata = numpy.array(wave.struct.unpack('%dh' % (len(data) / sw),
                         data)) * window
    fftData = abs(numpy.fft.rfft(indata)) ** 2
    which = fftData[1:].argmax() + 1
    if which != len(fftData) - 1:
        (y0, y1, y2) = numpy.log(fftData[which - 1:which + 2])
        x1 = (y2 - y0) * .5 / (2 * y1 - y2 - y0)
        freq = (which + x1) * rate / frames
    else:
        freq = which * rate / frames
    freq = numdec(round(freq))

    tone = checkfreq(freq, reffreq)
    if tone:
        if debug:
            print('Freq: %i (tone %s)' % (freq, tone))
        train.append(tone)
        tone = None
    elif train and tone == None and tonenone == 3:
        cleantrain(train)
        train = []
        tonenone = 0
    elif train and tone == None and tonenone == 0:
        tonenone = 1
    elif train and tone == None and tonenone == 1:
        tonenone = 2
    elif train and tone == None and tonenone == 2:
        tonenone = 3
    elif debug:
        print('Freq: %i' % freq)

    if ainput:
        data = streaminput.read(frames)
    else:
        data = wav.readframes(frames)

if data and play:
    stream.write(data)

if play:
    stream.close()
    pa.terminate()

if train:
    cleantrain(train)


            
