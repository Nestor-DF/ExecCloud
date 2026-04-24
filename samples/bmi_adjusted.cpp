#include <iostream>
#include <cstdlib>
#include <cmath>

int main(int argc, char* argv[]) {
    if (argc != 6) {
        std::cerr << "Usage: bmi_adjusted <weight_kg> <height_m> <age> <sex(0=female,1=male)> <activity_level>" << std::endl;
        return 1;
    }

    double weight = std::atof(argv[1]);
    double height = std::atof(argv[2]);
    int age = std::atoi(argv[3]);
    int sex = std::atoi(argv[4]);
    int activity = std::atoi(argv[5]); // 1–5

    if (height <= 0 || weight <= 0) {
        std::cerr << "Invalid input values." << std::endl;
        return 1;
    }

    // BMI base
    double bmi = weight / (height * height);

    // Ajuste por edad
    double age_factor = 1.0 + (age - 30) * 0.002;

    // Ajuste por sexo
    double sex_factor = (sex == 1) ? 1.05 : 0.95;

    // Ajuste por nivel de actividad (1 = bajo, 5 = alto)
    double activity_factor = 1.0 - (activity - 3) * 0.03;

    double adjusted_bmi = bmi * age_factor * sex_factor * activity_factor;

    std::cout << adjusted_bmi << std::endl;

    return 0;
}
