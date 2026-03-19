#!/bin/bash

echo "Generating scale datasets..."

# Small city (~100 segments): rows=9, cols=5 = (9+1)*5 + (5+1)*9 = 50 + 54 = 104 segments
echo "Generating small_city.json (~100 segments)..."
python3 cli.py generate small_city.json --rows 9 --cols 5

# Medium city (~500 segments): rows=22, cols=11 = (22+1)*11 + (11+1)*22 = 253 + 264 = 517 segments
echo "Generating medium_city.json (~500 segments)..."
python3 cli.py generate medium_city.json --rows 22 --cols 11

# Large city (~1000 segments): rows=31, cols=16 = (31+1)*16 + (16+1)*31 = 512 + 527 = 1039 segments
echo "Generating large_city.json (~1000 segments)..."
python3 cli.py generate large_city.json --rows 31 --cols 16

echo "All datasets generated successfully!"