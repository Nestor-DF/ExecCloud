#include <iostream>
#include <cstdlib>

int main(int argc, char* argv[]) {
    if (argc != 3) {
        std::cerr << "Usage: divide <a> <b>" << std::endl;
        return 1;
    }
    
    // Parse arguments as floats to allow decimal division
    double a = std::atof(argv[1]);
    double b = std::atof(argv[2]);
    
    if (b == 0) {
        std::cerr << "Error: Division by zero" << std::endl;
        return 1;
    }
    
    std::cout << (a / b) << std::endl;
    
    return 0;
}
