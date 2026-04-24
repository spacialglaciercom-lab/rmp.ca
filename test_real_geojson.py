#!/usr/bin/env python3
"""
Test script using real GeoJSON data from the downloads folder.
This demonstrates how to use the optimizer with real-world road network data.
"""

import sys
import json
sys.path.append("backend")

from app.optimize import optimize_route_sync
from app.main import app
from starlette.testclient import TestClient

def test_real_geojson():
    """Test optimization with real GeoJSON data."""
    
    # Load the GeoJSON file
    geojson_path = "/home/drone/Downloads/extract-b2miw4dvq9.geojson"
    
    try:
        with open(geojson_path, 'r') as f:
            geojson_data = json.load(f)
        
        print(f"Loaded GeoJSON with {len(geojson_data['features'])} road features")
        
        # Create a test client
        client = TestClient(app)
        
        # Create request body
        body = {
            'geojson': geojson_data,
            'clean_before_optimize': True,
            'revisit_penalty': 1.0  # Default (no penalty)
        }
        
        # Run optimization
        print("Running optimization...")
        response = client.post('/api/optimize/sync', json=body)
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Optimization successful!")
            print(f"Total distance: {result['total_distance_km']:.2f} km")
            print(f"Route points: {len(result['route'])}")
            print(f"Turns - Right: {result['stats']['right_turns']}, Left: {result['stats']['left_turns']}, U-turns: {result['stats']['u_turns']}")
            print(f"Deadhead distance: {result['stats']['deadhead_distance_km']:.2f} km")
            print(f"Efficiency: {result['stats']['efficiency']:.1f}%")
            return True
        else:
            print(f"❌ Optimization failed with status {response.status_code}")
            print(f"Error: {response.text}")
            return False
            
    except FileNotFoundError:
        print(f"❌ GeoJSON file not found: {geojson_path}")
        return False
    except json.JSONDecodeError:
        print(f"❌ Invalid JSON in file: {geojson_path}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

if __name__ == "__main__":
    success = test_real_geojson()
    sys.exit(0 if success else 1)
