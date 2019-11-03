
# Sepac SellCall decoder

Project originally based off of py5mon by Mathias Bøhn Grytemark. Copied, adapated under Creative Commons Attribution-ShareAlike 3.0 uported License. 

## Description
As stated above originally based off of the py5mon script adapted to decode Sepac SellCalls.

## Useage
For WAV Files
```
python3 SepacDecoder.py -p 821-K1.wav 
```

For Mic Input
```
python3 SepacDecoder.py -i
```



## Dependencies
This is the stuff I hate. 

UNIX: 
0. Python 3 - Should be installed already.
1. PortAudio
```sh
brew install portaudio
```
2. PyAudio
```sh
sudo pip install pyaudio
```
3. Numpy - Should be installed. 
```sh
pip install numpy
```
4.Wave 
```sh 
sudo pip install wave
```


## Installation

Unix Systems:
```sh
cd /yourDirectory/
git clone http://www.github.com/DanCRichards/SepacDecoder
```

## Usage examples: 

```sh
python SepacDecoder.py yourFile.wav
```

Options:
  -h, --help   show this help message and exit
  -d, --debug  Enable debugging
  -p, --play   Play the file out loud
  -i, --input  Use line-in/mic as input instead of FILE. Do not specify FILE
               or -p with this.



## Problems you might get: 

1. Audio file needs to be .wav - Use iTunes / Audacity.
2. Installing dependcies - Use Google

## Copyright / License
* Licensed under a Creative Commons Attribution-ShareAlike 3.0 Unported License.
* http://creativecommons.org/licenses/by-sa/3.0/
* Thanks to Justin Peel at stackoverflow.com for some code (the important part which gets me the frequencies used). 
* http://stackoverflow.com/questions/2648151/python-frequency-detection/2649540#2649540


