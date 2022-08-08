
function (add_custom_test)
    catkin_add_gtest(${PROJECT_NAME}-test
        ${ARGV}
    )
endfunction()