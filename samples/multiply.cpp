#include <iostream>
#include <cstdlib>

int main(int argc, char* argv[]) {
    if (argc != 3) {
        std::cerr << "Usage: multiply <a> <b>" << std::endl;
        return 1;
    }
    
    // Parse arguments
    int a = std::atoi(argv[1]);
    int b = std::atoi(argv[2]);
    
    // Output the result format expected by the frontend (just the resulting string)
    std::cout << (a * b) << std::endl;
    
    return 0;
}
