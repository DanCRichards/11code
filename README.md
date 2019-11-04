
# Sepac SellCall decoder

Project originally based off of py5mon by Mathias Bøhn Grytemark. Copied, adapated under Creative Commons Attribution-ShareAlike 3.0 uported License. 

## Description
As stated above originally based off of the py5mon script adapted to decode Sepac SellCalls.


### Dependencies

UNIX or macOS (Unsure of Windows capaability):
0. Python 3 - Should be installed already.
1. PortAudio
2. PyAudio
3. Numpy - Should be installed. 
4. Wave 


## Installation and running

```sh
cd /yourDirectory/
git clone http://www.github.com/DanCRichards/SepacDecoder
python SepacDecoder.py -i
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


