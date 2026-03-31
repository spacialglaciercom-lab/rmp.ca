"""
Test suite for loop prevention in the route optimizer.
"""

import json
import sys
sys.path.insert(0, '/home/drone/Downloads/rmp.ca-main/backend')

from app.optimize import _run_optimize, OptimizeRequest
from app.geojson_ops import GeoJSONFeatureCollection


def test_no_excessive_looping():
    """Test that routes don't contain excessive backtracking patterns."""
    # Test with known problematic GeoJSON
    with open('/home/drone/Downloads/extract-f7rbvxfry4.geojson') as f:
        geojson_data = json.load(f)

    body = OptimizeRequest(geojson=GeoJSONFeatureCollection(**geojson_data))
    result = _run_optimize(body)

    # Extract route nodes for analysis
    route_nodes = [f"{p.latitude},{p.longitude}" for p in result.route]
    
    # Check for excessive reversals (A->B->A patterns)
    reversals = 0
    for i in range(1, len(route_nodes)-1):
        if route_nodes[i-1] == route_nodes[i+1] and route_nodes[i-1] != route_nodes[i]:
            reversals += 1

    print(f"Reversals found: {reversals}")
    assert reversals <= 3, f"Too many reversals: {reversals}"

    # Check efficiency metric
    efficiency = result.stats.efficiency
    print(f"Route efficiency: {efficiency}%")
    assert efficiency >= 85.0, f"Route efficiency too low: {efficiency}%"

    print("✅ Loop prevention test passed!")


def test_loop_detection_functionality():
    """Test that loop detection works correctly."""
    from app.optimize import _detect_loop_pattern, _remove_immediate_reversals
    
    # Test case with obvious looping pattern
    looping_route = ['A', 'B', 'A', 'C', 'B', 'C', 'D', 'C', 'D']
    
    # Should detect loop pattern
    assert _detect_loop_pattern(looping_route) == True, "Should detect loop pattern"
    
    # Test reversal removal
    cleaned_route = _remove_immediate_reversals(looping_route)
    print(f"Original: {looping_route}")
    print(f"Cleaned: {cleaned_route}")
    
    # Should have fewer reversals
    original_reversals = sum(1 for i in range(1, len(looping_route)-1) 
                            if looping_route[i-1] == looping_route[i+1])
    cleaned_reversals = sum(1 for i in range(1, len(cleaned_route)-1) 
                           if cleaned_route[i-1] == cleaned_route[i+1])
    
    print(f"Original reversals: {original_reversals}")
    print(f"Cleaned reversals: {cleaned_reversals}")
    assert cleaned_reversals < original_reversals, "Reversal removal should reduce reversals"
    
    print("✅ Loop detection test passed!")


def test_geometric_constraints():
    """Test that geometric constraints improve matching."""
    # This would require more complex setup with actual geographic data
    # For now, just verify the function exists and runs
    from app.optimize import _solve_cpp, _build_graph
    from app.geojson_ops import _get_road_class
    
    # Load test data
    with open('/home/drone/Downloads/extract-f7rbvxfry4.geojson') as f:
        geojson_data = json.load(f)
    
    # Convert to proper feature objects
    from app.geojson_ops import GeoJSONFeature
    features = []
    for f in geojson_data['features']:
        if f['geometry']['type'] in ('LineString', 'MultiLineString'):
            features.append(GeoJSONFeature(**f))
    
    # Build graph
    G = _build_graph(features, oneway_mode="respect")
    
    # Test that CPP solution runs without errors
    route = _solve_cpp(G, turn_penalties={})
    assert len(route) > 0, "CPP solution should return valid route"
    
    print("✅ Geometric constraints test passed!")


if __name__ == "__main__":
    print("Running loop prevention tests...")
    
    try:
        test_no_excessive_looping()
        test_loop_detection_functionality()
        test_geometric_constraints()
        print("\n🎉 All loop prevention tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)