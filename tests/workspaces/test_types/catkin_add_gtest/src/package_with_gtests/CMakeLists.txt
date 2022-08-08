cmake_minimum_required(VERSION 3.0.2)
project(package_with_gtests)

find_package(catkin REQUIRED)


catkin_package()

include_directories()

catkin_add_gtest(${PROJECT_NAME}-test
    test/test.cpp
    test/test_f.cpp
    test/test_p.cpp
    test/test_typed_test.cpp
    test/test_typed_test_p.cpp
    test/test_typed_test_p_with_param.cpp
    test/test_typed_test_with_mapping.cpp
    test/main.cpp
)
